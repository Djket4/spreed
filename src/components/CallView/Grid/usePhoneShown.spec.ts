/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { usePhoneShown } from './usePhoneShown.ts'

describe('usePhoneShown (NAS_CLOUD#159)', () => {
	const make = (n: number) => reactive(Array.from({ length: n }, (_, i) => ({ attributes: { peerId: 'p' + (i + 1), speaking: false } })))
	const ids = (list: { value: { attributes: { peerId: string } }[] }) => list.value.map((m) => m.attributes.peerId)

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000_000)
	})
	afterEach(() => vi.useRealTimers())

	test('the first four in the display order are shown', () => {
		const models = ref(make(6))
		expect(ids(usePhoneShown(models, ref(null), 4))).toEqual(['p1', 'p2', 'p3', 'p4'])
	})

	test('guest: the speaker from outside the four takes the place of whoever was silent the longest, others stay put', () => {
		const models = ref(make(7))
		const promoted = ref<string | null>(null)
		const shown = usePhoneShown(models, promoted, 4)
		// p1, p3 and p4 spoke recently, p2 the longest ago
		const say = (id: string, ms: number) => {
			const m = models.value.find((x) => x.attributes.peerId === id)!
			m.attributes.speaking = true
			vi.advanceTimersByTime(ms)
			m.attributes.speaking = false
		}
		say('p2', 100)
		vi.advanceTimersByTime(5000)
		say('p1', 100)
		say('p3', 100)
		say('p4', 100)
		// p6 spoke (never shown) and has been held
		models.value[5].attributes.speaking = true
		promoted.value = 'p6'
		expect(ids(shown)).toEqual(['p1', 'p6', 'p3', 'p4'])
	})

	test('a speaker who is already shown changes nothing', () => {
		const models = ref(make(7))
		const promoted = ref<string | null>(null)
		const shown = usePhoneShown(models, promoted, 4)
		models.value[2].attributes.speaking = true
		promoted.value = 'p3'
		expect(ids(shown)).toEqual(['p1', 'p2', 'p3', 'p4'])
	})

	test('somebody leaves: the free place is filled in the display order', () => {
		const models = ref(make(7))
		const shown = usePhoneShown(models, ref(null), 4)
		models.value.splice(1, 1)
		expect(ids(shown)).toEqual(['p1', 'p3', 'p4', 'p5'])
	})
})
