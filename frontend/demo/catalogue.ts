import shared from '../../shared/locales/messages.json';
import demo from './messages.json';

// The same JSON object is used by src/i18n. Only demo entry graphs load this module.
Object.assign(shared, demo);
