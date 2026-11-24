/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import BrowserStorage from '../../services/BrowserStorage.js'
import { calllog } from '../calllog.js'
import MediaDevicesManager from './MediaDevicesManager.js'

vi.mock('../calllog.js', () => ({ calllog: vi.fn() }))

describe('MediaDevicesManager getUserMedia', () => {
	afterEach(() => {
		vi.clearAllMocks()
		vi.unstubAllGlobals()
	})

	test.each([true, false])('rejects one denied capture while device enumeration was pending (success: %s)', async (enumerationSucceeds) => {
		const denial = new DOMException('Access denied', 'NotAllowedError')
		const manager = new MediaDevicesManager()
		const getUserMedia = vi.fn().mockRejectedValue(denial)
		const enumerateDevices = vi.fn().mockResolvedValue([])
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } })
		manager._pendingEnumerateDevicesPromise = enumerationSucceeds ? Promise.resolve() : Promise.reject(new Error('Enumeration failed'))

		await expect(manager.getUserMedia({ audio: true }, 'preview')).rejects.toBe(denial)
		expect(getUserMedia).toHaveBeenCalledTimes(1)
		expect(calllog).toHaveBeenCalledExactlyOnceWith('gum_err', { name: 'NotAllowedError', a: true, v: false, src: 'preview' })
	})
})

describe('MediaDevicesManager audio output', () => {
	const speaker = { kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }
	const headset = { kind: 'audiooutput', deviceId: 'headset', label: 'Headset' }

	afterEach(() => {
		for (const key of ['audioOutputId', 'audioOutputPreferences', 'audioOutputDevicePreferred']) {
			BrowserStorage.removeItem(key)
		}
		vi.unstubAllGlobals()
	})

	test.each([null, 'default', 'local-storage-null-device-id'])('follows the system with no saved explicit output (%s)', async (savedId) => {
		BrowserStorage.setItem('audioOutputPreferences', JSON.stringify([speaker, headset]))
		// A marker can remain from selecting the old browser default entry.
		BrowserStorage.setItem('audioOutputDevicePreferred', true)
		if (savedId !== null) {
			BrowserStorage.setItem('audioOutputId', savedId)
		}
		const manager = new MediaDevicesManager()
		const enumerateDevices = vi.fn().mockResolvedValueOnce([speaker]).mockResolvedValueOnce([headset, speaker])
		vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices } })

		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe('')
		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe('')
	})

	test('restores a saved explicit output and returns to system routing when it disappears', async () => {
		BrowserStorage.setItem('audioOutputId', speaker.deviceId)
		const manager = new MediaDevicesManager()
		const enumerateDevices = vi.fn()
			.mockResolvedValueOnce([{ kind: 'audiooutput', deviceId: '', label: '' }])
			.mockResolvedValueOnce([speaker])
			.mockResolvedValueOnce([headset, speaker])
			.mockResolvedValueOnce([headset])
			.mockResolvedValueOnce([speaker, headset])
		vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices } })

		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe('')
		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe(speaker.deviceId)
		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe(speaker.deviceId)
		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe('')
		expect(BrowserStorage.getItem('audioOutputId')).toBeNull()
		await manager._updateDevices()
		expect(manager.get('audioOutputId')).toBe('')

		manager.set('audioOutputId', speaker.deviceId)
		expect(manager.get('audioOutputId')).toBe(speaker.deviceId)
		manager.set('audioOutputId', '')
		expect(manager.get('audioOutputId')).toBe('')
		expect(BrowserStorage.getItem('audioOutputId')).toBeNull()
	})
})
