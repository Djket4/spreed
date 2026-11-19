/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'
import { createStore } from 'vuex'
import storeConfig from '../../../store/storeConfig.js'
import VideoVue from './VideoVue.vue'

vi.mock('../../../utils/attachmediastream.js', () => ({
	default: (stream, el) => {
		el.srcObject = stream
	},
}))

// ket4tec (NAS_CLOUD#159): крупный VideoVue переиспользуется для другого участника
describe('VideoVue.vue: смена участника на том же компоненте', () => {
	beforeEach(() => setActivePinia(createPinia()))

	const person = (id, stream) => reactive({ attributes: { peerId: id, nextcloudSessionId: 's' + id, videoAvailable: true, stream, name: id, connectionState: 'completed' } })
	const shared = () => ({ promoted: false, screenVisible: false, remoteVideoBlocker: { increaseVisibleCounter: vi.fn(), decreaseVisibleCounter: vi.fn(), isVideoEnabled: () => true } })

	test('A с потоком -> B без потока: в <video> нет потока A', async () => {
		const streamA = { id: 'A', getVideoTracks: () => [] }
		const a = person('a', streamA)
		const b = person('b', null)
		const sa = shared()
		const sb = shared()
		const wrapper = mount(VideoVue, {
			global: { plugins: [createStore(storeConfig)], stubs: { NcButton: true, NcAvatar: true, VideoBottomBar: true } },
			props: { model: a, sharedData: sa, token: 'T', isGrid: true, isBig: true },
		})
		const video = wrapper.find('video').element
		expect(video.srcObject.id).toBe('A')

		await wrapper.setProps({ model: b, sharedData: sb })
		expect(video.srcObject ?? null).toBeNull()
		expect(sa.remoteVideoBlocker.decreaseVisibleCounter).toHaveBeenCalled()
		expect(sb.remoteVideoBlocker.increaseVisibleCounter).toHaveBeenCalled()
		wrapper.unmount()
	})
})
