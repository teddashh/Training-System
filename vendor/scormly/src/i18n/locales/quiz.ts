import type { LocaleTable } from '../types'

// UI strings for the quiz block.
const quiz: LocaleTable = {
  en: {
    passingScore: 'Passing score, %',
    showAnswers: 'Show correct answers',
    showAnswersHelp: 'After submitting, reveal which answers were right and any feedback. Off shows only the score.',
    questionN: 'Question {n}',

    typeSingle: 'Single answer',
    typeMultiple: 'Multiple answers',
    typeMatching: 'Matching',
    typeSequence: 'Put in order',
    typeFillBlanks: 'Fill in the blanks',
    typeSingleDesc: 'One correct option',
    typeMultipleDesc: 'Several correct options',
    typeMatchingDesc: 'Pair items with answers, or sort them into categories',
    typeSequenceDesc: 'Arrange the steps in the right order',
    typeFillBlanksDesc: 'Type or pick the missing words',
    questionType: 'Question type',

    promptLabel: 'Question',
    promptPlaceholder: 'Question text…',

    questionFeedback: 'Overall feedback',
    questionFeedbackPlaceholder: 'Explanation shown after answering (optional)',

    optionPlaceholder: 'Option text',
    optionFeedbackPlaceholder: 'Feedback',
    pairLeftPlaceholder: 'Left',
    pairRightPlaceholder: 'Right',

    addOption: '+ Option',
    addPair: '+ Pair',
    addQuestion: '+ Add question',

    removeQuestion: 'Remove question',
    removeOption: 'Remove option',
    removePair: 'Remove pair',
    correctOption: 'Correct option',
  },
  uk: {
    passingScore: 'Прохідний бал, %',
    showAnswers: 'Показувати правильні відповіді',
    showAnswersHelp: 'Після відповіді показувати, що правильно, і фідбек. Вимкнено — лише бал.',
    questionN: 'Питання {n}',

    typeSingle: 'Одна відповідь',
    typeMultiple: 'Декілька відповідей',
    typeMatching: 'Відповідність',
    typeSequence: 'Упорядкувати',
    typeFillBlanks: 'Заповнити пропуски',
    typeSingleDesc: 'Один правильний варіант',
    typeMultipleDesc: 'Кілька правильних варіантів',
    typeMatchingDesc: 'Поєднати пари або розсортувати за категоріями',
    typeSequenceDesc: 'Розставити кроки в правильному порядку',
    typeFillBlanksDesc: 'Вписати чи обрати пропущені слова',
    questionType: 'Тип питання',

    promptLabel: 'Питання',
    promptPlaceholder: 'Текст питання…',

    questionFeedback: 'Загальний фідбек',
    questionFeedbackPlaceholder: 'Пояснення після відповіді (необов’язково)',

    optionPlaceholder: 'Текст варіанта',
    optionFeedbackPlaceholder: 'Фідбек',
    pairLeftPlaceholder: 'Ліворуч',
    pairRightPlaceholder: 'Праворуч',

    addOption: '+ Варіант',
    addPair: '+ Пара',
    addQuestion: '+ Додати питання',

    removeQuestion: 'Видалити питання',
    removeOption: 'Видалити варіант',
    removePair: 'Видалити пару',
    correctOption: 'Правильний варіант',
  },
}

export default quiz
