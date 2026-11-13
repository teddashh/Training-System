from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.db.models.functions import Lower


def seed_lock(apps, schema_editor):
    apps.get_model('training', 'DirectorySyncState').objects.using(schema_editor.connection.alias).get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [('training', '0018_outbound_email')]
    operations = [
        migrations.AddField(model_name='user', name='job_title', field=models.CharField(max_length=200, blank=True)),
        migrations.AddField(model_name='user', name='directory_seen_at', field=models.DateTimeField(null=True, blank=True)),
        migrations.AddField(model_name='user', name='directory_disabled_at', field=models.DateTimeField(null=True, blank=True)),
        migrations.CreateModel(name='DirectorySyncState', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('last_run_at', models.DateTimeField(null=True, blank=True)),
            ('next_scheduled_attempt_at', models.DateTimeField(null=True, blank=True)),
        ]),
        migrations.RunPython(seed_lock, migrations.RunPython.noop),
        migrations.AddConstraint(model_name='user', constraint=models.UniqueConstraint(Lower('entra_subject'), name='unique_user_entra_subject_ci')),
        migrations.CreateModel(name='TrainingGroup', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('name', models.CharField(max_length=100)),
            ('description', models.CharField(max_length=2000, blank=True)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('updated_at', models.DateTimeField(auto_now=True)),
            ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='created_training_groups', to=settings.AUTH_USER_MODEL)),
        ], options={'constraints': [models.UniqueConstraint(Lower('name'), name='unique_training_group_name_ci')]}),
        migrations.CreateModel(name='TrainingGroupMembership', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('added_at', models.DateTimeField(auto_now_add=True)),
            ('added_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='added_training_group_memberships', to=settings.AUTH_USER_MODEL)),
            ('user', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='training_group_memberships', to=settings.AUTH_USER_MODEL)),
            ('group', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='training.traininggroup')),
        ], options={'constraints': [models.UniqueConstraint(fields=['group', 'user'], name='unique_training_group_member')]}),
        migrations.AddField(model_name='traininggroup', name='members', field=models.ManyToManyField(related_name='training_groups', through='training.TrainingGroupMembership', through_fields=('group', 'user'), to=settings.AUTH_USER_MODEL)),
        migrations.AddField(model_name='exam', name='allowed_groups', field=models.ManyToManyField(blank=True, related_name='exams', to='training.traininggroup')),
        migrations.AlterField(model_name='exam', name='audience', field=models.CharField(max_length=20, default='all', choices=[
            ('all', 'Everyone'), ('employees', 'Employees'), ('contractors', 'Contractors'), ('departments', 'Departments'),
            ('people', 'Selected people'), ('groups', 'Groups'), ('invitation', 'Invitation only'),
        ])),
    ]
