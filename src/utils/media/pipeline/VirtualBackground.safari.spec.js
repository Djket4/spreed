/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test, vi } from 'vitest'
import VirtualBackground from './VirtualBackground.js'

// ket4tec (NAS_CLOUD#160)
vi.mock('../../browserCheck.ts', () => ({ isSafari: true }))

describe('VirtualBackground in Safari', () => {
	test('isSupported() is false even if wasm and webgl are available', () => {
		vi.spyOn(VirtualBackground, 'isWasmSupported').mockReturnValue(true)
		vi.spyOn(VirtualBackground, 'isWebGLSupported').mockReturnValue(true)

		expect(VirtualBackground.isSupported()).toBe(false)
	})
})
