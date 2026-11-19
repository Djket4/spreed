/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Ref } from 'vue'

import { computed, ref, watch } from 'vue'

type PhoneModel = { attributes: { peerId: string, speaking?: boolean } }

/**
 * ket4tec (NAS_CLOUD#159): iPhone вертикально, 7+ участников - на экране `cap` собеседников без листания.
 * Говорящий (тот же, что крупный в «Говорящем крупно», после удержания) всегда в показанных - у любого пользователя,
 * включая гостя, у которого useTileOrdering порядок не меняет. Подъём стабильный: вытесняется тот из показанных, кто дольше
 * всех молчал, остальные остаются на своих местах (на его место встаёт говорящий).
 *
 * @param models - all remote participants in their display order
 * @param promotedPeerId - peer id of the held speaker, if any
 * @param cap - how many remote tiles fit
 */
export function usePhoneShown<T extends PhoneModel>(models: Readonly<Ref<T[]>>, promotedPeerId: Readonly<Ref<string | null>>, cap: number) {
	const shownIds = ref<string[]>([])
	// when each participant last spoke (0 - never)
	const lastSpoke: Record<string, number> = {}

	const speakingIds = computed(() => models.value.filter((model) => model.attributes.speaking).map((model) => model.attributes.peerId))
	watch(speakingIds, (now, before) => {
		before.forEach((id) => {
			lastSpoke[id] = Date.now()
		})
		now.forEach((id) => {
			lastSpoke[id] = Date.now()
		})
	}, { flush: 'sync' })

	const recency = (id: string) => (speakingIds.value.includes(id) ? Number.POSITIVE_INFINITY : (lastSpoke[id] ?? 0))

	/**
	 * Recompute the shown ids: leavers drop out, free places are filled in the display order, the speaker takes the
	 * place of whoever was silent the longest.
	 */
	function sync() {
		const ids = models.value.map((model) => model.attributes.peerId)
		const next = shownIds.value.filter((id) => ids.includes(id))
		ids.forEach((id) => {
			if (next.length < cap && !next.includes(id)) {
				next.push(id)
			}
		})
		const speaker = promotedPeerId.value
		// a speaker is somebody who has spoken: the first participant is flagged as large before anyone speaks
		if (speaker && ids.includes(speaker) && !next.includes(speaker) && lastSpoke[speaker]) {
			const evicted = next.reduce((a, b) => (recency(b) < recency(a) ? b : a))
			next[next.indexOf(evicted)] = speaker
		}
		shownIds.value = next
	}

	watch([() => models.value.map((model) => model.attributes.peerId).join('|'), promotedPeerId], sync, { immediate: true, flush: 'sync' })

	return computed(() => shownIds.value
		.map((id) => models.value.find((model) => model.attributes.peerId === id))
		.filter((model): model is T => model !== undefined))
}
