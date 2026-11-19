/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { subscribe } from '@nextcloud/event-bus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, onMounted, reactive } from 'vue'
import CallView from './CallView.vue'
import { useCallViewStore } from '../../stores/callView.ts'
import { callParticipantCollection, localMediaModel } from '../../utils/webrtc/index.js'

vi.mock('@nextcloud/event-bus', () => ({
	EventBus: {
		on: vi.fn(),
		off: vi.fn(),
	},
	emit: vi.fn(),
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
}))

vi.mock('./Grid/tilePromotionTransition.ts', () => ({ animateTilePromotion: vi.fn() }))

vi.mock('../../utils/webrtc/index.js', async () => ({
	beforeLeaveCall: { fn: null },
	k4drawSignaling: () => null,
	callParticipantCollection: {
		callParticipantModels: [],
		on: vi.fn(),
		off: vi.fn(),
	},
	localCallParticipantModel: {
		attributes: {
			peerId: 'local-peer',
		},
	},
	localMediaModel: {
		attributes: (await vi.importActual('vue')).reactive({
			localScreen: null,
			videoEnabled: false,
		}),
		disableAudio: vi.fn(),
		disableVideo: vi.fn(),
	},
}))

describe('CallView.vue', () => {
	const TOKEN = 'XXTOKENXX'
	let wrapper

	beforeEach(() => {
		setActivePinia(createPinia())
	})

	afterEach(() => {
		wrapper?.unmount()
	})

	const mountCallView = (props = {}) => {
		return mount(CallView, {
			props: {
				token: TOKEN,
				...props,
			},
			global: {
				stubs: {
					ViewerOverlayCallView: true,
					EmptyCallView: true,
					VideoVue: true,
					LocalVideo: true,
					ScreenShare: true,
					PresenterOverlay: true,
					VideosGrid: true,
					ReactionToaster: true,
					LiveTranscriptionRenderer: true,
					BottomBar: true,
				},
			},
		})
	}

	test('k4-unpin-video event unpins the video', async () => {
		wrapper = mountCallView()
		const handler = subscribe.mock.calls.find(([name]) => name === 'k4-unpin-video')[1]
		const unpinVideo = vi.spyOn(wrapper.vm.callViewStore, 'unpinVideo').mockImplementation(() => {})
		handler()
		expect(unpinVideo).toHaveBeenCalledWith(TOKEN, false)
	})

	describe('grid: слой simulcast (NAS_CLOUD#375)', () => {
		const dpr = window.devicePixelRatio
		beforeEach(() => {
			vi.useFakeTimers()
			window.devicePixelRatio = 1
			useCallViewStore().setCallViewMode({ token: TOKEN, isGrid: true })
		})
		afterEach(() => {
			vi.useRealTimers()
			window.devicePixelRatio = dpr
			callParticipantCollection.callParticipantModels = []
		})
		let seq = 0
		const m = () => ({ attributes: { peerId: 'p' + (++seq) }, setSimulcastVideoQuality: vi.fn() })
		const tileSize = async (width) => {
			wrapper.findComponent({ name: 'VideosGrid' }).vm.$emit('tileSize', width)
			await vi.advanceTimersByTimeAsync(300)
		}
		const spatials = (models) => models.map((model) => model.setSimulcastVideoQuality.mock.lastCall?.[0])

		test('состав 3 -> 4 -> 5 -> 4 плитки (со своей) меняет слой у всех моделей', async () => {
			const models = reactive([m(), m()]) // 2 удалённых + своя = 3 плитки
			callParticipantCollection.callParticipantModels = models
			wrapper = mountCallView()
			await tileSize(700)
			expect(spatials(models)).toEqual([2, 2])

			models.push(m()) // 4 плитки
			await flushPromises()
			expect(spatials(models)).toEqual([2, 2, 2])

			models.push(m()) // 5 плиток: все получают MEDIUM
			await flushPromises()
			expect(spatials(models)).toEqual([1, 1, 1, 1])

			models.pop() // снова 4
			await flushPromises()
			expect(spatials(models)).toEqual([2, 2, 2])
		})

		test('в записи своей плитки нет: 4 удалённых = 4 плитки, HIGH', async () => {
			const models = reactive([m(), m(), m(), m()])
			callParticipantCollection.callParticipantModels = models
			wrapper = mountCallView({ isRecording: true })
			await tileSize(700)
			expect(spatials(models)).toEqual([2, 2, 2, 2])
		})

		test('узкая плитка: MEDIUM даже при двух участниках; расширение даёт HIGH, гистерезис не дёргает', async () => {
			const models = reactive([m()])
			callParticipantCollection.callParticipantModels = models
			wrapper = mountCallView()
			await tileSize(400)
			expect(spatials(models)).toEqual([1])

			await tileSize(620) // выше 600, но внутри гистерезиса (< 630)
			expect(spatials(models)).toEqual([1])
			await tileSize(700)
			expect(spatials(models)).toEqual([2])

			await tileSize(580) // выше нижней границы 570: слой держится
			expect(spatials(models)).toEqual([2])
			await tileSize(540)
			expect(spatials(models)).toEqual([1])
		})

		test('смена DPR без tileSize пересчитывает слой; после unmount слушатель снят', async () => {
			const mqs = []
			const origMM = window.matchMedia
			window.matchMedia = vi.fn((query) => {
				const mq = { query, addEventListener: vi.fn(), removeEventListener: vi.fn() }
				mqs.push(mq)
				return mq
			})
			const models = reactive([m()])
			callParticipantCollection.callParticipantModels = models
			wrapper = mountCallView()
			await tileSize(400)
			expect(spatials(models)).toEqual([1])
			const first = mqs.find((mq) => mq.query === '(resolution: 1dppx)')
			expect(first.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

			window.devicePixelRatio = 2
			first.addEventListener.mock.calls[0][1]()
			await vi.advanceTimersByTimeAsync(300)
			expect(spatials(models)).toEqual([2])
			expect(first.removeEventListener).toHaveBeenCalled()
			const second = mqs.find((mq) => mq.query === '(resolution: 2dppx)')
			expect(second.addEventListener).toHaveBeenCalled()

			wrapper.unmount()
			expect(second.removeEventListener).toHaveBeenCalledWith('change', second.addEventListener.mock.calls[0][1])
			window.matchMedia = origMM
		})

		test('физическая ширина: CSS-ширина x devicePixelRatio', async () => {
			window.devicePixelRatio = 2
			const models = reactive([m()])
			callParticipantCollection.callParticipantModels = models
			wrapper = mountCallView()
			await tileSize(320) // 640 физ. px
			expect(spatials(models)).toEqual([2])
		})
	})

	test('pin, unpin via k4-unpin-video event: pin is cleared and the view is restored', async () => {
		const store = useCallViewStore()
		store.setCallViewMode({ token: TOKEN, isGrid: true })
		store.setSelectedVideoPeerId('peer-1')
		store.setCallViewMode({ token: TOKEN, isGrid: false, clearLast: false })
		wrapper = mountCallView()
		const handler = subscribe.mock.calls.findLast(([name]) => name === 'k4-unpin-video')[1]
		handler()
		expect(store.selectedVideoPeerId).toBeNull()
		expect(store.isGrid).toBe(true)
	})

	test('own screen share started while own camera is pinned still restores the grid (NAS_CLOUD#159)', async () => {
		const store = useCallViewStore()
		store.setCallViewMode({ token: TOKEN, isGrid: true })
		store.setSelectedVideoPeerId('local')
		store.setCallViewMode({ token: TOKEN, isGrid: false, clearLast: false })
		wrapper = mountCallView()

		localMediaModel.attributes.localScreen = {}
		await flushPromises()
		expect(store.presentationStarted).toBe(true)

		store.setSelectedVideoPeerId(null) // unpin while sharing
		await flushPromises()
		localMediaModel.attributes.localScreen = null
		await flushPromises()

		expect(store.presentationStarted).toBe(false)
		expect(store.isGrid).toBe(true)
	})

	describe('говорящий крупно (NAS_CLOUD#159)', () => {
		let seq = 0
		const person = (video = true) => {
			const id = 'q' + (++seq)
			return {
				attributes: { peerId: id, nextcloudSessionId: 's' + id, speaking: false, videoAvailable: video, stream: video ? {} : undefined },
				setSimulcastVideoQuality: vi.fn(),
				setVideoBlocked: vi.fn(),
			}
		}
		let models
		let mounts
		const Big = defineComponent({
			props: ['model'],
			setup() {
				onMounted(() => mounts++)
				return () => h('video', { class: 'big-stub' })
			},
		})
		beforeEach(() => {
			vi.useFakeTimers()
			mounts = 0
			models = reactive([person(), person(), person()])
			callParticipantCollection.callParticipantModels = models
			useCallViewStore().setCallViewMode({ token: TOKEN, isGrid: false })
			wrapper = mount(CallView, {
				props: { token: TOKEN },
				global: {
					stubs: {
						ViewerOverlayCallView: true,
						EmptyCallView: true,
						VideoVue: Big,
						LocalVideo: true,
						ScreenShare: true,
						PresenterOverlay: true,
						VideosGrid: true,
						ReactionToaster: true,
						LiveTranscriptionRenderer: true,
						BottomBar: true,
					},
				},
			})
		})
		afterEach(() => {
			vi.useRealTimers()
			callParticipantCollection.callParticipantModels = []
		})
		const bigPeer = () => wrapper.vm.promotedParticipantModel.attributes.peerId

		test('короткий звук (кашель) не переключает крупного', async () => {
			const first = bigPeer()
			models[2].attributes.speaking = true
			await vi.advanceTimersByTimeAsync(800)
			models[2].attributes.speaking = false
			await vi.advanceTimersByTimeAsync(3000)
			expect(bigPeer()).toBe(first)
		})

		test('говорит 2 с подряд - становится крупным; замолчал - остаётся последний говоривший', async () => {
			models[2].attributes.speaking = true
			await vi.advanceTimersByTimeAsync(2100)
			expect(bigPeer()).toBe(models[2].attributes.peerId)
			models[2].attributes.speaking = false
			await vi.advanceTimersByTimeAsync(60_000)
			expect(bigPeer()).toBe(models[2].attributes.peerId)
		})

		test('ушёл крупный собеседник - крупным не становится свой, а кто-то из собеседников', async () => {
			models[1].attributes.speaking = true
			await vi.advanceTimersByTimeAsync(2100)
			models.splice(1, 1)
			await flushPromises()
			expect(models.map((x) => x.attributes.peerId)).toContain(bigPeer())
		})

		test('нажатие на свою плитку ничего не закрепляет', async () => {
			wrapper.vm.handleClickLocalVideo()
			await flushPromises()
			expect(useCallViewStore().selectedVideoPeerId).toBeNull()
			expect(wrapper.vm.showLocalVideo).toBe(false)
		})

		test('смена крупного с видео на видео оставляет тот же <video> (не пересоздаётся, без чёрного кадра)', async () => {
			const el = wrapper.find('.big-stub').element
			models[2].attributes.speaking = true
			await vi.advanceTimersByTimeAsync(2100)
			expect(bigPeer()).toBe(models[2].attributes.peerId)
			await flushPromises()
			expect(wrapper.find('.big-stub').element).toBe(el)
			expect(mounts).toBe(1)
		})
	})

	describe('video overlay mouse/keyboard activity tracking', () => {
		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.restoreAllMocks()
			vi.useRealTimers()
		})

		test('showVideoOverlay becomes false after 5000ms of inactivity', async () => {
			wrapper = mountCallView()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Trigger activity to start the timer
			await wrapper.find('div#call-container').trigger('mousemove')

			vi.advanceTimersByTime(5000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)
		})

		test('handleMovement resets the timer', async () => {
			wrapper = mountCallView()

			// Start the initial timer
			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Advance 3 seconds
			vi.advanceTimersByTime(3000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Call handleMovement to reset timer
			await wrapper.find('div#call-container').trigger('mousemove')

			// Still visible
			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Advance another 3 seconds (6 total from start, but 3 from reset)
			vi.advanceTimersByTime(3000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Advance final 2 seconds (5 from the reset)
			vi.advanceTimersByTime(2000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)
		})

		test('handleMovement sets showVideoOverlay to true', async () => {
			wrapper = mountCallView()

			// Start the timer
			await wrapper.find('div#call-container').trigger('mousemove')

			// Let the overlay hide
			vi.advanceTimersByTime(5000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)

			// Call handleMovement again
			await wrapper.find('div#call-container').trigger('mousemove')

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)
		})

		test('hideOverlay immediately sets showVideoOverlay to false', async () => {
			wrapper = mountCallView()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			await wrapper.find('div#call-container').trigger('mouseleave')

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)
		})
	})
})
