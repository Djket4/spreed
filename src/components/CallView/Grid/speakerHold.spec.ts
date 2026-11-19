/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createSpeakerHold, SPEAKER_HOLD_MS } from './speakerHold.ts'

describe('speakerHold (NAS_CLOUD#159)', () => {
	let onChange: ReturnType<typeof vi.fn>
	let hold: ReturnType<typeof createSpeakerHold>

	beforeEach(() => {
		vi.useFakeTimers()
		onChange = vi.fn()
		hold = createSpeakerHold(onChange)
	})
	afterEach(() => {
		hold.dispose()
		vi.useRealTimers()
	})

	test('a short sound does not switch', () => {
		hold.setSpeaking('a', true)
		vi.advanceTimersByTime(SPEAKER_HOLD_MS - 100)
		hold.setSpeaking('a', false)
		vi.advanceTimersByTime(10_000)
		expect(onChange).not.toHaveBeenCalled()
	})

	test('speaking for the hold time switches once', () => {
		hold.setSpeaking('a', true)
		hold.setSpeaking('a', true)
		vi.advanceTimersByTime(SPEAKER_HOLD_MS)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('a')
	})

	test('the last speaker stays when everybody is silent', () => {
		hold.setSpeaking('a', true)
		vi.advanceTimersByTime(SPEAKER_HOLD_MS)
		hold.setSpeaking('a', false)
		vi.advanceTimersByTime(120_000)
		expect(hold.current()).toBe('a')
	})

	test('the current speaker is interrupted by a cough, not replaced', () => {
		hold.setSpeaking('a', true)
		vi.advanceTimersByTime(SPEAKER_HOLD_MS)
		hold.setSpeaking('b', true)
		vi.advanceTimersByTime(500)
		hold.setSpeaking('b', false)
		vi.advanceTimersByTime(5000)
		expect(hold.current()).toBe('a')
	})

	test('a participant who left is dropped', () => {
		hold.setSpeaking('a', true)
		vi.advanceTimersByTime(SPEAKER_HOLD_MS)
		hold.remove('a')
		expect(hold.current()).toBeNull()
		expect(onChange).toHaveBeenLastCalledWith(null)
	})
})
