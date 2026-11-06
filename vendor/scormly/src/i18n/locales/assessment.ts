import type { LocaleTable } from '../types'

// UI strings for the scored exercise blocks other than the quiz: ordering
// ("Sort / order") and fill in the blanks — editor and learner preview.
// Passing score / show answers labels are shared with the `quiz` namespace.
const assessment: LocaleTable = {
  en: {
    // Ordering — editor
    modeSequence: 'Put in order',
    modeCategories: 'Sort into categories',
    promptLabel: 'Task',
    promptPlaceholder: 'Instruction for the learner…',
    itemsSequence: 'Items, in the correct order',
    itemsSequenceHelp: 'Learners see them shuffled and put them back in this order.',
    itemsCategories: 'Items',
    itemPlaceholder: 'Item text',
    addItem: '+ Item',
    removeItem: 'Remove item',
    moveUp: 'Move up',
    moveDown: 'Move down',
    categoriesLabel: 'Categories',
    categoryPlaceholder: 'Category name',
    addCategory: '+ Category',
    removeCategory: 'Remove category',
    itemCategory: 'Correct category',
    noCategory: '— Category —',

    // Ordering — learner
    sequenceHint: 'Drag the items, or use the arrows, to put them in the right order.',
    categoriesHint: 'Drag each item into a category, or pick one from its list.',
    unsorted: 'Not sorted yet',
    chooseCategory: 'Choose a category',
    correctPosition: 'Correct position: {n}',
    correctCategory: 'Correct: {c}',
    dragItem: 'Drag to reorder',

    // Fill in the blanks — editor
    textLabel: 'Text with blanks',
    textPlaceholder: 'The capital of France is [Paris].',
    textHelp: 'Wrap each answer in square brackets: [Paris]. Separate other accepted answers with |, e.g. [Paris|Paname] — the first one is the correct answer.',
    fbModeType: 'Type the answer',
    fbModeSelect: 'Choose from a list',
    caseSensitive: 'Case-sensitive answers',
    caseSensitiveHelp: 'Off: "paris" also counts as "Paris". Applies to typed answers.',
    blanksCount: 'Blanks: {n}',
    noBlanks: 'No blanks yet — wrap an answer in [square brackets].',

    // Fill in the blanks — learner
    blankN: 'Blank {n}',
    correctAnswer: 'Answer: {a}',
  },
  uk: {
    // Ordering — editor
    modeSequence: 'Упорядкувати',
    modeCategories: 'Розсортувати за категоріями',
    promptLabel: 'Завдання',
    promptPlaceholder: 'Інструкція для слухача…',
    itemsSequence: 'Елементи в правильному порядку',
    itemsSequenceHelp: 'Слухач бачить їх перемішаними й відновлює цей порядок.',
    itemsCategories: 'Елементи',
    itemPlaceholder: 'Текст елемента',
    addItem: '+ Елемент',
    removeItem: 'Видалити елемент',
    moveUp: 'Вище',
    moveDown: 'Нижче',
    categoriesLabel: 'Категорії',
    categoryPlaceholder: 'Назва категорії',
    addCategory: '+ Категорія',
    removeCategory: 'Видалити категорію',
    itemCategory: 'Правильна категорія',
    noCategory: '— Категорія —',

    // Ordering — learner
    sequenceHint: 'Перетягніть елементи або скористайтеся стрілками, щоб розставити їх у правильному порядку.',
    categoriesHint: 'Перетягніть кожен елемент у категорію або оберіть її зі списку.',
    unsorted: 'Ще не розсортовано',
    chooseCategory: 'Оберіть категорію',
    correctPosition: 'Правильна позиція: {n}',
    correctCategory: 'Правильно: {c}',
    dragItem: 'Перетягніть, щоб змінити порядок',

    // Fill in the blanks — editor
    textLabel: 'Текст із пропусками',
    textPlaceholder: 'Столиця Франції — [Париж].',
    textHelp: 'Візьміть кожну відповідь у квадратні дужки: [Париж]. Інші прийнятні відповіді відокремте |, напр. [Париж|Paris] — перша з них правильна.',
    fbModeType: 'Ввести відповідь',
    fbModeSelect: 'Обрати зі списку',
    caseSensitive: 'Враховувати регістр',
    caseSensitiveHelp: 'Вимкнено: «париж» теж зараховується як «Париж». Стосується введених відповідей.',
    blanksCount: 'Пропусків: {n}',
    noBlanks: 'Пропусків ще немає — візьміть відповідь у [квадратні дужки].',

    // Fill in the blanks — learner
    blankN: 'Пропуск {n}',
    correctAnswer: 'Відповідь: {a}',
  },
}

export default assessment
