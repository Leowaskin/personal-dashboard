import { DateTime } from 'luxon';
import { briefingRepository, planRepository, settingsRepository, taskRepository } from './repository.js';
import { searchNewsTopics } from './web-search.js';

export async function generateBriefing(date?: string) {
  const prefs = settingsRepository.get();
  const localDate = date ?? DateTime.now().setZone(prefs.timezone).toISODate()!;
  const start = DateTime.fromISO(localDate, { zone: prefs.timezone }).startOf('day');
  const end = start.endOf('day');
  const blocks = planRepository.blocksForDay(start.toISO()!, end.toISO()!);
  const active = taskRepository.active().filter((task) => task.status === 'PENDING');
  const scheduled = new Set(blocks.map((block) => block.taskId));
  const lines = [`Good morning, Leo!`, '', `Your plan for ${start.toFormat('cccc, LLLL d')}:`];
  if (!blocks.length) lines.push('• No task blocks are scheduled yet.');
  for (const block of blocks) {
    const task = active.find((item) => item.id === block.taskId);
    lines.push(`• ${DateTime.fromISO(block.start).setZone(prefs.timezone).toFormat('h:mm a')}–${DateTime.fromISO(block.end).setZone(prefs.timezone).toFormat('h:mm a')}: ${task?.title ?? 'Task'}`);
  }
  const unscheduled = active.filter((task) => !scheduled.has(task.id));
  if (unscheduled.length) lines.push('', `${unscheduled.length} task${unscheduled.length === 1 ? '' : 's'} could not be scheduled: ${unscheduled.map((task) => task.title).join(', ')}.`);
  if (prefs.includeNewsInBriefing) {
    const headlines = await searchNewsTopics(prefs.newsTopics);
    lines.push('', 'News to watch:');
    if (headlines.length) {
      for (const headline of headlines) lines.push(`• ${headline.title} — ${headline.url}`);
    } else {
      lines.push('• Live news is unavailable right now.');
    }
  }
  return briefingRepository.create(localDate, lines.join('\n'));
}
