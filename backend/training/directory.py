"""Complete-list directory provisioning. Never link by a mutable login identifier."""
import json
import logging
import math
import re
import time
import threading
from functools import partial
from datetime import datetime, timedelta, timezone as dt_timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

import msal
import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from .runtime_settings import sign_in_config
from .models import AuditEvent, DirectorySyncState, Identity, User
from .services import audit

GRAPH_USER_FIELDS = 'id,displayName,mail,userPrincipalName,department,jobTitle,employeeId,employeeType,accountEnabled,userType,assignedLicenses'

ERRORS = {
    'not_configured': 'Directory sync is not configured. Set the directory credentials and matching Entra tenant.',
    'permission': 'The directory app lacks the Microsoft Graph application permission User.Read.All. Ask the tenant owner to approve admin consent.',
    'group_permission': 'The directory app lacks the Microsoft Graph application permission GroupMember.Read.All. Ask the tenant owner to approve admin consent.',
    'group_missing': 'The Entra group no longer exists or cannot be read; members were not changed.',
    'throttled': 'Microsoft Graph is throttling directory requests. Try again later.',
    'network': 'Directory sync could not reach Microsoft Graph. Try again later.',
    'invalid_listing': 'Directory sync received an incomplete or invalid listing. No changes were applied.',
    'busy': 'Another directory sync is running. Try again later.',
    'conflict': 'Directory accounts changed during sync. No changes were applied. Preview again.',
    'failed': 'Directory sync failed. Nothing was changed.',
}


class DirectoryError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(ERRORS[code])


class GraphDeadlineExceeded(DirectoryError):
    """Distinguish an exhausted fetch budget without exposing provider data."""
    def __init__(self, deadline):
        self.deadline = deadline
        super().__init__('invalid_listing')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def tenant_id():
    try:
        tenant = str(UUID(settings.GRAPH_DIRECTORY_TENANT_ID or settings.GRAPH_MAIL_TENANT_ID))
        if tenant != str(UUID(sign_in_config().get('tenant_id', ''))):
            raise ValueError()
        return tenant
    except (ValueError, AttributeError, TypeError):
        raise DirectoryError('not_configured') from None


def credentials():
    tenant = tenant_id()
    try:
        client = str(UUID(settings.GRAPH_DIRECTORY_CLIENT_ID or settings.GRAPH_MAIL_CLIENT_ID))
        secret = settings.GRAPH_DIRECTORY_CLIENT_SECRET or settings.GRAPH_MAIL_CLIENT_SECRET
        if not secret:
            raise ValueError()
        return tenant, client, secret
    except (ValueError, AttributeError, TypeError):
        raise DirectoryError('not_configured') from None


def configured():
    try:
        credentials()
        return True
    except DirectoryError:
        return False


def validate_link(url, *, path="/v1.0/users"):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.hostname != 'graph.microsoft.com'
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.fragment or parsed.path.casefold() != path.casefold()):
            raise ValueError()
    except (ValueError, TypeError):
        raise DirectoryError('invalid_listing') from None
    return url


def retry_delay(value):
    try:
        seconds = float(value)
        return max(0, seconds) if math.isfinite(seconds) else 31
    except (ValueError, TypeError):
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(dt_timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return 1


def graph_fetch(url, *, path, opener=None, token=None, sleep=time.sleep,
                headers=None, single=False, limit=None, truncate=False,
                permission_code='permission', missing_code='network', deadline=None):
    """Shared complete-page transport: validate every URL, never redirects or bodies in logs."""
    own_deadline = time.monotonic() + 90
    external_limit = deadline is not None and deadline <= own_deadline
    deadline = min(own_deadline, deadline) if deadline is not None else own_deadline

    def remaining():
        budget = deadline - time.monotonic()
        if budget <= 0:
            raise GraphDeadlineExceeded(deadline)
        return budget

    remaining()
    tenant, client_id, secret = credentials()
    if token is None:
        try:
            # MSAL can make multiple discovery/token requests. Share the same
            # absolute budget and disable the default transport's hidden retries.
            with requests.Session() as http:
                send = http.request

                def request_token(method, url, **kwargs):
                    kwargs.update(timeout=min(15, remaining()), allow_redirects=False)
                    try:
                        response = send(method, url, **kwargs)
                    finally:
                        remaining()
                    return response

                http.request = request_token
                client = msal.ConfidentialClientApplication(
                    client_id, authority=f'https://login.microsoftonline.com/{tenant}',
                    client_credential=secret, timeout=min(15, remaining()), http_client=http,
                )
                token = client.acquire_token_for_client(scopes=['https://graph.microsoft.com/.default']).get('access_token')
            remaining()
            if not token:
                raise DirectoryError('not_configured')
        except DirectoryError:
            raise
        except Exception:
            raise DirectoryError('network') from None
    opener = opener or build_opener(NoRedirect())  # uses the environment's proxy configuration
    records, visited = [], set()
    while url:
        validate_link(url, path=path)
        remaining()
        if url in visited or len(visited) >= 1000:
            raise DirectoryError('invalid_listing')
        visited.add(url)
        for attempt in range(3):
            try:
                request = Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json', **(headers or {})})
                with opener.open(request, timeout=min(15, remaining())) as response:
                    if response.status != 200:
                        raise DirectoryError('network')
                    page = json.load(response)
                break
            except HTTPError as exc:
                budget = remaining()
                if exc.code == 403:
                    raise DirectoryError(permission_code) from None
                if exc.code == 404:
                    raise DirectoryError(missing_code) from None
                if exc.code in (429, 503):
                    delay = retry_delay(exc.headers.get('Retry-After', '1'))
                    # Never retry earlier than Retry-After; defer the run when it exceeds our budget.
                    if attempt < 2 and external_limit and delay >= budget:
                        raise GraphDeadlineExceeded(deadline) from None
                    if attempt == 2 or delay > 30 or delay >= budget:
                        raise DirectoryError('throttled') from None
                    sleep(delay)
                    continue
                raise DirectoryError('network') from None
            except (URLError, TimeoutError, OSError):
                remaining()
                raise DirectoryError('network') from None
            except (ValueError, TypeError):
                remaining()
                raise DirectoryError('invalid_listing') from None
        remaining()
        if single:
            if not isinstance(page, dict) or '@odata.nextLink' in page:
                raise DirectoryError('invalid_listing')
            return page
        if not isinstance(page, dict) or not isinstance(page.get('value'), list):
            raise DirectoryError('invalid_listing')
        records.extend(page['value'])
        if limit is not None and len(records) > limit and not truncate:
            raise DirectoryError('invalid_listing')
        url = page.get('@odata.nextLink')
        if '@odata.nextLink' in page and (not isinstance(url, str) or not url):
            raise DirectoryError('invalid_listing')
        if truncate and limit is not None and len(records) >= limit:
            return records[:limit]
    return records


def graph_listing(*, opener=None, token=None, sleep=time.sleep):
    url = 'https://graph.microsoft.com/v1.0/users?' + urlencode({
        '$select': GRAPH_USER_FIELDS, '$top': 999,
    })
    return graph_fetch(url, path='/v1.0/users', opener=opener, token=token, sleep=sleep)


def file_listing(path):
    try:
        with open(path, encoding='utf-8') as stream:
            page = json.load(stream)
        if not isinstance(page, dict) or not isinstance(page.get('value'), list) or '@odata.nextLink' in page:
            raise ValueError()
        return page['value']
    except (OSError, ValueError, TypeError):
        raise DirectoryError('invalid_listing') from None


_email_clients = {}
_email_clients_lock = threading.Lock()


def email_lookup_client():
    tenant, client_id, secret = credentials()
    key = (tenant, client_id)
    with _email_clients_lock:
        cached = _email_clients.get(key)
        if cached is None or cached[0] != secret:
            # MSAL's default transport retries connection failures. A code request
            # must fail promptly instead; Session defaults to zero retries and
            # retains proxy discovery from the environment.
            http = requests.Session()
            http.request = partial(http.request, timeout=10, allow_redirects=False)
            client = msal.ConfidentialClientApplication(
                client_id, authority=f'https://login.microsoftonline.com/{tenant}',
                client_credential=secret, timeout=10, http_client=http,
            )
            _email_clients[key] = (secret, client)
        return _email_clients[key][1]


def graph_email_lookup(email, *, opener=None, sleep=time.sleep):
    """Bounded exact-mail lookup; a next page is ambiguous, never followed."""
    validate_email(email)
    token = email_lookup_client().acquire_token_for_client(
        scopes=['https://graph.microsoft.com/.default'],
    ).get('access_token')
    if not token:
        raise DirectoryError('not_configured')
    url = validate_link('https://graph.microsoft.com/v1.0/users?' + urlencode({
        '$filter': "mail eq '" + email.replace("'", "''") + "'",
        '$select': GRAPH_USER_FIELDS, '$top': 2,
    }))
    opener = opener or build_opener(NoRedirect())
    for attempt in range(2):
        try:
            request = Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
            with opener.open(request, timeout=10) as response:
                if response.status != 200:
                    raise DirectoryError('network')
                page = json.load(response)
            break
        except HTTPError as exc:
            if exc.code not in (429, 503) or attempt:
                raise
            value = exc.headers.get('Retry-After') if exc.headers else None
            # Missing/invalid headers do not authorize a retry.
            try:
                delay = float(value)
            except (TypeError, ValueError):
                try:
                    delay = (parsedate_to_datetime(value) - datetime.now(dt_timezone.utc)).total_seconds()
                except (TypeError, ValueError, OverflowError):
                    raise exc from None
            if not math.isfinite(delay) or delay > 5 or delay < 0:
                raise
            sleep(delay)
    if not isinstance(page, dict) or not isinstance(page.get('value'), list) or '@odata.nextLink' in page:
        raise DirectoryError('invalid_listing')
    return page['value']


def email_code_domain(email):
    try:
        validate_email(email)
    except ValidationError:
        return False
    return email.rsplit('@', 1)[-1].casefold() in {
        domain.strip().casefold() for domain in settings.EMAIL_CODE_DOMAINS if domain.strip()
    }


def provision_email_user(email, *, records=None, dry_run=False, source='email_code'):
    """Fail closed with the same external response, including uniqueness races."""
    try:
        if not email_code_domain(email) or not configured():
            return None
        records = graph_email_lookup(email) if records is None else records
        if len(records) != 1:
            return None
        record = clean_listing(records)[0]
        if (record['userType'] != 'Member' or not record['accountEnabled']
                or email_for(record) != email or not email_code_domain(email_for(record))):
            return None
        values = profile_values(record, email)
        if len(values['employee_id']) > User._meta.get_field('employee_id').max_length:
            return None
        user = new_directory_user(record, tenant_id(), timezone.now(), values)
        with transaction.atomic():
            if User.objects.filter(entra_subject__iexact=user.entra_subject).exists():
                return None
            accounts, identities = Q(), Q()
            for value in (user.email, user.employee_id, user.username):
                if value:
                    accounts |= Q(email__iexact=value) | Q(employee_id__iexact=value) | Q(username__iexact=value)
                    identities |= Q(key__iexact='email:' + value) | Q(key__iexact='account:' + value)
            if (User.objects.filter(accounts).exists()
                    or Identity.objects.exclude(user_id=None).filter(identities).exists()):
                return None
            if dry_run:
                return user
            user.save(force_insert=True)
            audit(None, 'directory.provision', user.pk, {'source': source})
        return user
    except Exception as exc:
        # Includes unique-constraint races: never adopt, replace or reactivate here.
        # No provider body, SQL, address, name or token may reach the log.
        logging.getLogger(__name__).warning('%s', type(exc).__name__)
        return None


# Bound concurrent sign-in lookups, including a transport that ignores socket
# timeouts. The worker only reads Graph: no late profile writes after timeout.
_signin_lookups = threading.BoundedSemaphore(4)


def graph_user_lookup(oid):
    from queue import Queue, Empty
    oid = str(UUID(oid))
    deadline = time.monotonic() + 4.5
    if not _signin_lookups.acquire(blocking=False):
        raise GraphDeadlineExceeded(deadline)
    result = Queue(maxsize=1)

    def fetch():
        try:
            path = '/v1.0/users/' + oid
            result.put((True, graph_fetch(
                'https://graph.microsoft.com' + path + '?' + urlencode({'$select': GRAPH_USER_FIELDS}),
                path=path, single=True, deadline=deadline,
            )))
        except Exception as exc:
            result.put((False, exc))
        finally:
            _signin_lookups.release()

    try:
        threading.Thread(target=fetch, daemon=True).start()
    except Exception:
        _signin_lookups.release()
        raise
    try:
        ok, value = result.get(timeout=max(0, deadline - time.monotonic()))
    except Empty:
        raise GraphDeadlineExceeded(deadline) from None
    if not ok:
        raise value
    return value


def refresh_signin_profile(user):
    """Best-effort external Member profile; False means explicitly disabled."""
    if not user.entra_subject:
        return True
    tenant, _, oid = user.entra_subject.casefold().partition(':')
    if tenant != sign_in_config().get('tenant_id', '').casefold():
        return True
    domains = {d.strip().casefold() for d in settings.DIRECTORY_EMAIL_DOMAINS if d.strip()}
    if user.email.rsplit('@', 1)[-1].casefold() in domains:
        return True
    now = timezone.now()
    if user.directory_seen_at and user.directory_seen_at > now - timedelta(hours=24):
        return True
    try:
        credentials()
        record = clean_listing([graph_user_lookup(oid)])[0]
        if record['id'] != str(UUID(oid)):
            raise DirectoryError('invalid_listing')
        # Guests retain existing sign-in behavior, including disabled Graph guests.
        if record['userType'] != 'Member':
            return True
        if not record['accountEnabled']:
            return False
        # External Member UPNs can be non-deliverable #EXT# addresses. Reuse
        # email validation without its UPN fallback; bulk sync stays unchanged.
        values = profile_values(record, email_for({'mail': record.get('mail')}))
        with transaction.atomic():
            current = User.objects.select_for_update().get(pk=user.pk)
            for field, value in values.items():
                if not value:
                    continue
                if field in ('email', 'employee_id'):
                    if (len(value) > User._meta.get_field(field).max_length
                            or User.objects.exclude(pk=user.pk).filter(
                                Q(email__iexact=value) | Q(employee_id__iexact=value) | Q(username__iexact=value)).exists()
                            or Identity.objects.exclude(user_id=None).exclude(user_id=user.pk).filter(
                                Q(key__iexact='email:' + value) | Q(key__iexact='account:' + value)).exists()):
                        continue
                setattr(current, field, value)
            current.directory_seen_at = now
            current.save(update_fields=[*PROFILE_FIELDS, 'email', 'directory_seen_at'])
        user.refresh_from_db()
        return user.is_active
    except Exception as exc:
        logging.getLogger(__name__).warning('%s', type(exc).__name__)
        return True


def clean_listing(records):
    """Reject malformed/duplicate objects rather than mistaking corrupt input for leavers."""
    cleaned, seen = [], set()
    for record in records:
        if not isinstance(record, dict):
            raise DirectoryError('invalid_listing')
        try:
            oid = str(UUID(record['id']))
            if oid in seen or type(record['accountEnabled']) is not bool:
                raise ValueError()
            if record.get('userType') not in ('Member', 'Guest') or not isinstance(record.get('assignedLicenses'), list):
                raise ValueError()
            for field in ('displayName', 'mail', 'userPrincipalName', 'department', 'jobTitle', 'employeeId', 'employeeType'):
                if record.get(field) is not None and not isinstance(record[field], str):
                    raise ValueError()
        except (KeyError, ValueError, TypeError, AttributeError):
            raise DirectoryError('invalid_listing') from None
        seen.add(oid)
        cleaned.append({**record, 'id': oid})
    return cleaned


def email_for(record):
    for field in ('mail', 'userPrincipalName'):
        email = (record.get(field) or '').strip().casefold()
        try:
            validate_email(email)
            if len(email) <= User._meta.get_field('email').max_length:
                return email
        except ValidationError:
            pass
    return ''


def eligibility(record, email):
    if record['userType'] != 'Member':
        return 'guest'
    if not record['accountEnabled']:
        return 'disabled'
    if not email:
        return 'no_email'
    if settings.DIRECTORY_REQUIRE_LICENSE and not record['assignedLicenses']:
        return 'unlicensed'
    domains = {d.strip().casefold() for d in settings.DIRECTORY_EMAIL_DOMAINS if d.strip()}
    if domains and email.rsplit('@', 1)[-1] not in domains:
        return 'domain'
    return None


PROFILE_FIELDS = {'display_name': 'displayName', 'department': 'department', 'job_title': 'jobTitle', 'employee_id': 'employeeId'}
WRITE_FIELDS = [*PROFILE_FIELDS, 'email', 'directory_seen_at', 'directory_disabled_at', 'is_active']


def profile_values(record, email):
    values = {field: (record.get(source) or '').strip()[:User._meta.get_field(field).max_length]
              for field, source in PROFILE_FIELDS.items()}
    values['email'] = email
    # Identifiers must never be truncated into another person's identifier.
    values['employee_id'] = (record.get('employeeId') or '').strip()
    return values


def new_directory_user(record, tenant, now, values):
    """Construct the same unsaved learner for bulk sync and one-person provisioning."""
    employment = (record.get('employeeType') or '').strip().casefold()
    user = User(username='entra_' + record['id'], entra_subject=f"{tenant}:{record['id']}",
                **{**values, 'employee_id': values['employee_id'] or None},
                employment='contractor' if re.search(r'\b(contractor|vendor|consultant|temporary|temp|contract)\b', employment) else 'employee',
                directory_seen_at=now)
    user.set_unusable_password()
    return user


def plan(records, tenant, now, *, allow_mass_deactivation=False, lock=False):
    counts = {key: 0 for key in ('create', 'update', 'unchanged', 'deactivate', 'reactivate', 'conflicts', 'protected')}
    counts['skipped'] = {key: 0 for key in ('guest', 'disabled', 'unlicensed', 'no_email', 'domain')}
    samples = {key: [] for key in (*counts, *counts['skipped']) if key != 'skipped'}

    def count(category, name):
        if category in counts['skipped']:
            counts['skipped'][category] += 1
        else:
            counts[category] += 1
        if len(samples[category]) < 20:
            samples[category].append(name)

    qs = User.objects.all()
    users = list(qs.select_for_update() if lock else qs)
    tenant = tenant.casefold()
    active_directory_count = sum(u.is_active and bool(u.entra_subject) and u.entra_subject.casefold().startswith(tenant + ':') for u in users)
    by_subject = {u.entra_subject.casefold(): u for u in users if u.entra_subject}
    # Reserve all original identifiers throughout the run. Never transfer identifiers
    # between people, even if another record changes its address in the same listing.
    identifiers = {}
    for user in users:
        for value in (user.email, user.employee_id, user.username):
            if value:
                identifiers.setdefault(value.casefold(), set()).add(user.pk)

    # Historical identifiers stay owned even after the current profile changes.
    # Unbound guest identities remain eligible for the existing explicit adoption flow.
    for key, owner in Identity.objects.exclude(user_id=None).values_list('key', 'user_id'):
        prefix, separator, value = key.casefold().partition(':')
        if separator and prefix in ('email', 'account') and value:
            identifiers.setdefault(value, set()).add(owner)

    def collision(value, owner):
        return bool(value and identifiers.get(value.casefold(), set()) - {owner})

    created, changed, listed, disabled = [], {}, set(), set()
    for record in records:
        subject = f"{tenant}:{record['id']}"
        listed.add(subject)
        if not record['accountEnabled']:
            disabled.add(subject)
        email = email_for(record)
        name = (record.get('displayName') or '')[:100]
        reason = eligibility(record, email)
        if reason:
            count(reason, name)
            continue
        user = by_subject.get(subject)
        values = profile_values(record, email)
        owner = user.pk if user else subject
        conflict = False
        for field in ('email', 'employee_id'):
            if len(values[field]) > User._meta.get_field(field).max_length or collision(values[field], owner):
                conflict = True
                values[field] = ''
        username = 'entra_' + record['id']
        if not user and collision(username, owner):
            conflict = True
        if conflict:
            count('conflicts', name)
        # A new person with any identifier conflict requires operator resolution.
        if not user:
            if conflict:
                count('unchanged', name)
                continue
            user = new_directory_user(record, tenant, now, values)
            created.append(user)
            count('create', name)
        else:
            original_disabled_at = user.directory_disabled_at
            updated = False
            for field, value in values.items():
                if value and getattr(user, field) != value:
                    setattr(user, field, value)
                    updated = True
            if not user.is_active and user.directory_disabled_at is not None:
                user.is_active = True
                user.directory_disabled_at = None
                count('reactivate', name)
            else:
                count('update' if updated else 'unchanged', name)
            user.directory_seen_at = now
            user._directory_profile_changed = updated or user.directory_disabled_at != original_disabled_at
            changed[user.pk] = user
        for value in (user.email, user.employee_id, user.username):
            if value:
                identifiers.setdefault(value.casefold(), set()).add(owner)

    active = [u for u in users if u.is_active and u.entra_subject]
    leavers = []
    for user in active:
        # Other tenants are never interpreted as absent from this tenant's listing.
        subject = user.entra_subject.casefold()
        if not subject.startswith(tenant + ':'):
            continue
        if subject not in listed or subject in disabled:
            # Deliberately unchanged: directory deactivation protection is independent of LMS roles.
            if user.role == 'admin' or user.is_staff or user.is_superuser:
                count('protected', user.display_name)
            else:
                leavers.append(user)
    samples['deactivation_candidates'] = [u.display_name for u in leavers[:20]]
    guarded = len(leavers) > max(20, active_directory_count * .1) and not allow_mass_deactivation
    if not guarded:
        for user in leavers:
            user.is_active = False
            user.directory_disabled_at = now
            user._directory_profile_changed = True
            changed[user.pk] = user
            count('deactivate', user.display_name)
    summary = {'counts': counts, 'samples': samples, 'mass_deactivation_guard': guarded,
               'deactivation_candidates': len(leavers)}
    return summary, created, list(changed.values())


def _sync_directory(*, apply=False, from_file=None, allow_mass_deactivation=False, actor=None, due=False, group_deadline=None):
    tenant = tenant_id()
    if not apply:
        records = clean_listing(file_listing(from_file) if from_file else graph_listing())
        return plan(records, tenant, timezone.now(), allow_mass_deactivation=allow_mass_deactivation)[0]
    with transaction.atomic():
        # Seeded by the additive migration. Serializes scheduled and manual runs,
        # including the fetch, so a stale listing cannot overtake a newer run.
        state = lock_sync_state()
        now = timezone.now()
        if due and (settings.DIRECTORY_SYNC_INTERVAL_HOURS <= 0 or (
                state.last_run_at and state.last_run_at > now - timedelta(hours=settings.DIRECTORY_SYNC_INTERVAL_HOURS))):
            return None
        records = clean_listing(file_listing(from_file) if from_file else graph_listing())
        for attempt in range(3):
            try:
                with transaction.atomic():
                    synced_at = timezone.now()
                    summary, created, changed = plan(records, tenant, synced_at,
                        allow_mass_deactivation=allow_mass_deactivation, lock=True)
                    User.objects.bulk_create(created, batch_size=500)
                    profiles = [u for u in changed if u._directory_profile_changed]
                    seen_only = [u.pk for u in changed if not u._directory_profile_changed]
                    # Bound expression memory too: Django builds all bulk_update
                    # expressions up front even when batch_size is specified.
                    for offset in range(0, len(profiles), 500):
                        User.objects.bulk_update(profiles[offset:offset + 500], WRITE_FIELDS, batch_size=500)
                    for offset in range(0, len(seen_only), 500):
                        User.objects.filter(pk__in=seen_only[offset:offset + 500]).update(directory_seen_at=synced_at)
                    audit(actor, 'directory.sync', 'directory', {
                        **summary['counts'], 'mass_deactivation_guard': int(summary['mass_deactivation_guard']),
                        'deactivation_candidates': summary['deactivation_candidates'],
                    })
                    state.last_run_at = timezone.now()
                    state.save(update_fields=['last_run_at'])
                    def sync_linked_groups():
                        from .entra_groups import sync_all
                        try:
                            summary['groups'] = sync_all(actor=actor, deadline=group_deadline)
                        except Exception:
                            logging.getLogger(__name__).warning('Entra group sync failed: failed')
                            summary['groups'] = dict(synced=0, unchanged=0, failed=1, guarded=0, deferred=0)
                    transaction.on_commit(sync_linked_groups)
                    return summary
            except IntegrityError as exc:
                if not user_identifier_collision(exc):
                    raise
                # A first SSO sign-in may have inserted a subject after our read.
                # Roll back this plan, reload ownership in bulk, and retry safely.
                if attempt == 2:
                    raise DirectoryError('conflict') from None


def lock_sync_state():
    try:
        return DirectorySyncState.objects.select_for_update(nowait=True).get(pk=1)
    except DatabaseError as exc:
        cause = exc.__cause__
        if getattr(cause, 'sqlstate', None) == '55P03' or getattr(cause, 'pgcode', None) == '55P03':
            raise DirectoryError('busy') from None
        raise


def user_identifier_collision(exc):
    """Only user uniqueness failures are expected first-sign-in races."""
    names = {'unique_user_email_ci', 'unique_username_ci', 'unique_user_entra_subject_ci',
             'training_user_username_key', 'training_user_employee_id_key', 'training_user_entra_subject_key'}
    cause = exc.__cause__
    if getattr(getattr(cause, 'diag', None), 'constraint_name', None) in names:
        return True
    # SQLite diagnostics for the offline test/development database. Never log SQL.
    if getattr(cause, 'sqlite_errorname', '') == 'SQLITE_CONSTRAINT_UNIQUE':
        message = str(cause)
        return message.startswith('UNIQUE constraint failed: training_user.') or any(
            message == f"UNIQUE constraint failed: index '{name}'" for name in names)
    return False


def sync_directory(**kwargs):
    try:
        return _sync_directory(**kwargs)
    except DirectoryError:
        raise
    except Exception as exc:
        # The apply transaction has already rolled back; never log SQL, exception
        # messages, Graph bodies, credentials or personal data, even in DEBUG.
        logging.getLogger(__name__).error('%s', type(exc).__name__)
        raise DirectoryError('failed') from None


# Fallback only if the database cannot persist the cooldown. Normal failures use
# the shared database field, so the delay survives process restarts.
_scheduled_retry_after = None


def scheduled_sync():
    global _scheduled_retry_after
    now = timezone.now()
    if settings.DIRECTORY_SYNC_INTERVAL_HOURS <= 0 or (_scheduled_retry_after and now < _scheduled_retry_after):
        return
    try:
        # Commit a reservation before contacting Microsoft; rollback of a failed
        # apply must not erase scheduling state. Other scheduler instances see it.
        with transaction.atomic():
            state = lock_sync_state()
            if ((state.next_scheduled_attempt_at and now < state.next_scheduled_attempt_at)
                    or (state.last_run_at and now < state.last_run_at + timedelta(hours=settings.DIRECTORY_SYNC_INTERVAL_HOURS))):
                return
            state.next_scheduled_attempt_at = now + timedelta(hours=1)
            state.save(update_fields=['next_scheduled_attempt_at'])
        sync_directory(apply=True, due=True)
        DirectorySyncState.objects.filter(pk=1).update(next_scheduled_attempt_at=None)
    except Exception as exc:
        retry_at = timezone.now() + timedelta(hours=1)
        if isinstance(exc, DirectoryError):
            if exc.code != 'failed':  # unexpected failures were logged by sync_directory
                logging.getLogger(__name__).warning('Directory sync failed: %s', exc.code)
        else:
            logging.getLogger(__name__).error('%s', type(exc).__name__)
        try:
            DirectorySyncState.objects.filter(pk=1).update(next_scheduled_attempt_at=retry_at)
        except DatabaseError:
            _scheduled_retry_after = retry_at


def directory_status():
    event = AuditEvent.objects.filter(action='directory.sync').select_related('actor').order_by('-created_at', '-pk').first()
    return {
        'configured': configured(), 'interval_hours': settings.DIRECTORY_SYNC_INTERVAL_HOURS,
        'last_run': {'at': event.created_at, 'actor': event.actor.display_name or event.actor.username if event.actor else None,
                     'counts': event.detail} if event else None,
    }
