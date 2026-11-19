/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#159): крупным в «Говорящем крупно» становится тот, кто говорит без перерыва HOLD_MS (кашель и короткие звуки
// не переключают). Пока никто не говорит - остаётся последний говоривший. Только собеседники: своя камера сюда не попадает.
export const SPEAKER_HOLD_MS = 2_000

/**
 * @param onChange - called with the peer id that became the large one (or null when it left)
 * @param holdMs - how long somebody has to speak without a break
 */
export function createSpeakerHold(onChange: (peerId: string | null) => void, holdMs = SPEAKER_HOLD_MS) {
	let current: string | null = null
	const timers = new Map<string, ReturnType<typeof setTimeout>>()

	/**
	 *
	 * @param peerId
	 */
	function clear(peerId: string) {
		clearTimeout(timers.get(peerId))
		timers.delete(peerId)
	}

	return {
		current: () => current,

		setSpeaking(peerId: string, speaking: boolean) {
			if (!speaking) {
				clear(peerId)
				return
			}
			if (peerId === current || timers.has(peerId)) {
				return
			}
			timers.set(peerId, setTimeout(() => {
				timers.delete(peerId)
				current = peerId
				onChange(peerId)
			}, holdMs))
		},

		remove(peerId: string) {
			clear(peerId)
			if (current === peerId) {
				current = null
				onChange(null)
			}
		},

		dispose() {
			[...timers.keys()].forEach(clear)
		},
	}
}
