export function grade(question, response) {
  if (!question.answer || question.type === 'short') return null;
  return question.answer.trim().startsWith(response) && response !== '';
}
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function accuracy(records) {
  const graded = records.filter(r => typeof r.correct === 'boolean');
  return graded.length ? Math.round(graded.filter(r => r.correct).length / graded.length * 100) : null;
}
