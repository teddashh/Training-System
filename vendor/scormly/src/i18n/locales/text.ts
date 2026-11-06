import type { LocaleTable } from '../types'

// UI strings for text blocks (heading, paragraph, list, note).
const text: LocaleTable = {
  en: {
    // Heading
    headingPlaceholder: 'Heading',
    headingLevel: 'Heading level {level}',

    // Paragraph
    bold: 'Bold',
    italic: 'Italic',
    paragraphPlaceholder: 'Enter text…',

    // List
    bulleted: 'Bulleted',
    numbered: 'Numbered',
    listItemPlaceholder: 'List item',
    removeItem: 'Remove item',
    addItem: 'Add item',

    // Note
    noteKind: 'Type',
    note: 'Note',
    tip: 'Tip',
    success: 'Success',
    warning: 'Warning',
    paragraphStyle: 'Style',
    para_normal: 'Normal',
    para_lead: 'Lead',
    para_dropcap: 'Drop cap',
    para_columns: 'Flowing columns',
    notePlaceholder: 'Note text',
    warningPlaceholder: 'Warning text',
  },
  uk: {
    // Heading
    headingPlaceholder: 'Заголовок',
    headingLevel: 'Рівень заголовка {level}',

    // Paragraph
    bold: 'Жирний',
    italic: 'Курсив',
    paragraphPlaceholder: 'Введіть текст…',

    // List
    bulleted: 'Маркований',
    numbered: 'Нумерований',
    listItemPlaceholder: 'Пункт списку',
    removeItem: 'Видалити пункт',
    addItem: 'Додати пункт',

    // Note
    noteKind: 'Тип',
    note: 'Примітка',
    tip: 'Порада',
    success: 'Успіх',
    warning: 'Попередження',
    paragraphStyle: 'Стиль',
    para_normal: 'Звичайний',
    para_lead: 'Лід',
    para_dropcap: 'Буквиця',
    para_columns: 'Текст у колонках',
    notePlaceholder: 'Текст примітки',
    warningPlaceholder: 'Текст попередження',
  },
}

export default text
