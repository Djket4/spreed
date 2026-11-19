/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'
import { createStore } from 'vuex'
import storeConfig from '../../../store/storeConfig.js'
import VideosGrid from './VideosGrid.vue'


// ket4tec (NAS_CLOUD#159): телефон вертикально, 7+ участников - 4 собеседника без страниц
describe('VideosGrid.vue: телефон, 7+ участников', () => {
	let wrapper
	let seq = 0
	const person = () => {
		const id = 'v' + (++seq)
		return { attributes: { peerId: id, nextcloudSessionId: 's' + id, speaking: false, videoAvailable: true, stream: {} } }
	}
	const sharedFor = (models) => Object.fromEntries(models.map((m) => [m.attributes.peerId, { promoted: false, remoteVideoBlocker: { isVideoEnabled: () => true }, screenVisible: false }]))

	beforeEach(() => {
		setActivePinia(createPinia())
		window.matchMedia = vi.fn((query) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
	})
	afterEach(() => wrapper?.unmount())

	const mountGrid = (models) => mount(VideosGrid, {
		props: {
			token: 'T',
			callParticipantModels: models,
			sharedDatas: sharedFor(models),
			localMediaModel: { attributes: {} },
			localCallParticipantModel: { attributes: { peerId: 'me' } },
		},
		global: { plugins: [createStore(storeConfig)], stubs: { VideoVue: { props: ['model'], template: '<div class="tile" />' }, LocalVideo: true, EmptyCallView: true, StripeControls: true, NcButton: true } },
	})

	test('окно всегда с нуля: со второй страницы альбома в портрет - первые четыре, без стрелок', async () => {
		const models = reactive(Array.from({ length: 5 }, person))
		wrapper = mountGrid(models)
		wrapper.vm.currentPage = 1
		models.push(person(), person(), person()) // 8 собеседников: 7+ с собой
		await flushPromises()
		expect(wrapper.vm.phoneMore).toBe(true)
		expect(wrapper.vm.currentPage).toBe(0)
		expect(wrapper.vm.displayedVideos.map((m) => m.attributes.peerId)).toEqual(models.slice(0, 4).map((m) => m.attributes.peerId))
		expect(wrapper.find('.grid-navigation').exists()).toBe(false)
		expect(wrapper.find('.k4-more-tile').text()).toBe('+4')
	})

	test('колесо в этом режиме страницу не листает', async () => {
		const models = reactive(Array.from({ length: 8 }, person))
		wrapper = mountGrid(models)
		await flushPromises()
		const next = vi.spyOn(wrapper.vm, 'next')
		wrapper.vm.gridWidth = 400
		wrapper.vm.handleWheelEvent({ deltaY: 10 })
		expect(next).not.toHaveBeenCalled()
		expect(wrapper.vm.currentPage).toBe(0)
	})
})
