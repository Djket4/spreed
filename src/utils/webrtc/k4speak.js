/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * ket4tec NAS_CLOUD#169: шкала «кто говорит» в клиенте записи.
 * Пишет смену признака speaking каждого удалённого участника с отметкой времени
 * в window.__k4speak; рекордер забирает её (splice) и кладёт jsonl рядом с записью.
 * Имя берётся в момент события: у гостя — как представился, у учётки — отображаемое.
 *
 * @param {object} collection CallParticipantCollection
 * @param {object} [target] куда положить журнал (window)
 * @param {Function} [now] часы, мс epoch
 * @return {Function} stop
 */
export function startK4speak(collection, target = window, now = () => Date.now()) {
	const log = { t0: now(), events: [] }
	target.__k4speak = log
	const onSpeaking = (m, speaking) => log.events.push({
		t: now(),
		peer: m.get('peerId') || null,
		actor: m.get('actorType') ? `${m.get('actorType')}/${m.get('actorId')}` : null,
		name: m.get('name') || null,
		speaking: !!speaking,
	})
	// ушёл, не договорив, — закрыть его отрезок
	const onRemove = (c, m) => {
		m.off('change:speaking', onSpeaking)
		if (m.get('speaking')) {
			onSpeaking(m, false)
		}
	}
	const onAdd = (c, m) => m.on('change:speaking', onSpeaking)
	collection.callParticipantModels.forEach((m) => onAdd(collection, m))
	collection.on('add', onAdd)
	collection.on('remove', onRemove)
	return () => {
		collection.off('add', onAdd)
		collection.off('remove', onRemove)
		collection.callParticipantModels.forEach((m) => m.off('change:speaking', onSpeaking))
	}
}
