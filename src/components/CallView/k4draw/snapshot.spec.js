/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest'
import { clampBox } from './snapshot.js'

describe('clampBox', () => {
	it('внутри кадра — без сдвига', () => {
		expect(clampBox([10, 10, 50, 20], 200, 100)).toEqual([0, 0])
	})
	it('у нижнего края', () => {
		expect(clampBox([10, 90, 50, 19], 200, 100)).toEqual([0, -9])
	})
	it('у правого края', () => {
		expect(clampBox([180, 10, 50, 20], 200, 100)).toEqual([-30, 0])
	})
	it('за левым/верхним краем', () => {
		expect(clampBox([-5, -3, 50, 20], 200, 100)).toEqual([5, 3])
	})
	it('в углу', () => {
		expect(clampBox([190, 95, 20, 20], 200, 100)).toEqual([-10, -15])
	})
	it('больше кадра — к левому/верхнему краю', () => {
		expect(clampBox([30, 20, 300, 150], 200, 100)).toEqual([-30, -20])
	})
})
