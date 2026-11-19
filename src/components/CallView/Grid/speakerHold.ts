/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#159): крупным в «Говорящем крупно» становится тот, кто говорит без перерыва HOLD_MS (кашель и короткие звуки
// не переключают). Пока никто не говорит - остаётся последний говоривший. Только собеседники: своя камера сюда не попадает.
// Когда крупный замолчал, а другой говорит давно - крупным становится он (нового перехода true от него уже не придёт).
export const SPEAKER_HOLD_MS = 2_000

/**
 * @param onChange - called with the peer id that became the large one (or null when it left)
 * @param holdMs - how long somebody has to speak without a break
 */
export function createSpeakerHold(onChange: (peerId: string | null) => void, holdMs = SPEAKER_HOLD_MS) {
	let current: string | null = null
	// who speaks now and since when
	const speakingSince = new Map<string, number>()
	const timers = new Map<string, ReturnType<typeof setTimeout>>()

	function clear(peerId: string) {
		clearTimeout(timers.get(peerId))
		timers.delete(peerId)
	}

	function take(peerId: string) {
		if (current !== peerId) {
			current = peerId
			onChange(peerId)
		}
	}

	// wait for whatever is left of the hold of a participant who speaks now
	function schedule(peerId: string) {
		const since = speakingSince.get(peerId)
		if (since === undefined || peerId === current || timers.has(peerId)) {
			return
		}
		const left = holdMs - (Date.now() - since)
		if (left <= 0) {
			take(peerId)
			return
		}
		timers.set(peerId, setTimeout(() => {
			timers.delete(peerId)
			if (speakingSince.has(peerId)) {
				take(peerId)
			}
		}, left))
	}

	// the current one is silent: the one speaking the longest takes over
	function handOver() {
		const next = [...speakingSince.entries()].filter(([id]) => id !== current).sort((a, b) => a[1] - b[1])
		next.forEach(([id]) => schedule(id))
	}

	return {
		current: () => current,

		setSpeaking(peerId: string, speaking: boolean) {
			if (!speaking) {
				speakingSince.delete(peerId)
				clear(peerId)
				if (peerId === current) {
					handOver()
				}
				return
			}
			if (speakingSince.has(peerId)) {
				return
			}
			speakingSince.set(peerId, Date.now())
			// the current speaker is silent already: the newcomer still has to hold
			schedule(peerId)
		},

		remove(peerId: string) {
			speakingSince.delete(peerId)
			clear(peerId)
			if (current === peerId) {
				current = null
				onChange(null)
				handOver()
			}
		},

		dispose() {
			[...timers.keys()].forEach(clear)
		},
	}
}
