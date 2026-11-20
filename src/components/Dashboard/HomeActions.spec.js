/*
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#378): окно «Новая встреча» — фокус и «Мой звонок» при отказе share.

import { showSuccess } from '@nextcloud/dialogs'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'
import TalkDashboard from './HomeActions.vue'

vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@nextcloud/auth', () => ({ getRequestToken: () => 't', getCurrentUser: () => null }))
for (const c of ['../LeftSidebar/ConversationsList/ConversationsListVirtual.vue', '../RightSidebar/SearchMessages/SearchMessageItem.vue', '../UIShared/LoadingPlaceholder.vue', './DashboardSection.vue', './EventCard.vue']) {
	vi.doMock(c, () => ({ default: { render: () => null } }))
}
vi.mock('@nextcloud/vue/composables/useIsDarkTheme', () => ({ useIsDarkTheme: () => ref(false) }))
vi.mock('@nextcloud/vue/composables/useIsMobile', () => ({ useIsMobile: () => ref(true), useIsSmallMobile: () => ref(true) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('vuex', () => ({ useStore: () => ({ getters: { conversationsInitialised: true, conversationsList: [] } }) }))
vi.mock('../../services/CapabilitiesManager.ts', () => ({
	getTalkConfig: (a, b, key) => key === 'enabled' || key === 'can-create',
	hasTalkFeature: () => false,
	localCapabilities: {},
}))
vi.mock('../../stores/dashboard.ts', () => ({
	useDashboardStore: () => ({
		eventRooms: [],
		upcomingReminders: [],
		fetchDashboardEventRooms: vi.fn(),
		fetchUpcomingReminders: vi.fn(),
	}),
}))
vi.mock('../../stores/actor.ts', () => ({ useActorStore: () => ({}) }))

const trap = vi.hoisted(() => ({ activate: vi.fn(), deactivate: vi.fn(), create: vi.fn() }))
vi.mock('focus-trap', () => ({
	createFocusTrap: (...args) => {
		trap.create(...args)
		return { activate: trap.activate, deactivate: trap.deactivate }
	},
}))

const stubs = {
	ConversationsListVirtual: true,
	SearchMessageItem: true,
	LoadingPlaceholder: true,
	DashboardSection: true,
	EventCard: true,
	NcButton: { template: '<button type="button" v-bind="$attrs"><slot /></button>' },
}

/**
 * @param {object} navShare значение navigator.share
 */
async function setup(navShare) {
	globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
	globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ call: 'https://x/call' }) }))
	globalThis.matchMedia = () => ({ matches: true })
	Object.defineProperty(navigator, 'share', { value: navShare, configurable: true })
	const wrapper = mount(TalkDashboard, { attachTo: document.body, global: { stubs } })
	await flushPromises()
	return wrapper
}

describe('HomeActions', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		document.body.innerHTML = ''
	})

	test('Escape closes the meeting window and focus returns to the opener', async () => {
		const wrapper = await setup(undefined)
		const opener = wrapper.findAll('button').find((b) => b.attributes('variant') === 'primary')
		opener.element.focus()
		await opener.trigger('click')
		await flushPromises()
		const input = document.getElementById('k7-meet-name')
		expect(document.activeElement).toBe(input)
		await input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await flushPromises()
		expect(document.querySelector('.k7-meet')).toBeNull()
		expect(document.activeElement).toBe(opener.element)
		wrapper.unmount()
	})

	test.each([
		['non-abort error', 'NotAllowedError', true],
		['AbortError', 'AbortError', true],
	])('share rejected with %s', async (_n, name, shown) => {
		const share = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name })))
		const wrapper = await setup(share)
		await wrapper.find('.k7-mycall').trigger('click')
		await flushPromises()
		expect(share).toHaveBeenCalled()
		expect(wrapper.find('.k7-mycall-copy').exists()).toBe(shown)
		wrapper.unmount()
	})

	test('AbortError does not write to the clipboard by itself', async () => {
		const writeText = vi.fn(() => Promise.resolve())
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		const wrapper = await setup(vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))))
		await wrapper.find('.k7-mycall').trigger('click')
		await flushPromises()
		expect(writeText).not.toHaveBeenCalled()
		wrapper.unmount()
	})

	async function offerCopy() {
		const wrapper = await setup(vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))))
		await wrapper.find('.k7-mycall').trigger('click')
		await flushPromises()
		return wrapper
	}

	test('share refusal turns «My call» itself into «Copy link», grid keeps its cells', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		const writeText = vi.fn(() => Promise.resolve())
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		const before = (await setup(vi.fn(() => Promise.resolve()))).findAll('.talk-dashboard__actions > *').length
		const wrapper = await offerCopy()
		expect(wrapper.findAll('.talk-dashboard__actions > *').length).toBe(before)
		expect(wrapper.find('.k7-mycall').classes()).toContain('k7-mycall-copy')
		expect(wrapper.find('.k7-mycall').text()).toContain('Copy link')
		await wrapper.find('.k7-mycall').trigger('click')
		await flushPromises()
		expect(writeText).toHaveBeenCalledWith('https://x/call')
		expect(wrapper.findAll('.talk-dashboard__actions > *').length).toBe(before)
		expect(wrapper.find('.k7-mycall').text()).toContain('Copied')
		expect(showSuccess).not.toHaveBeenCalled() // без тоста поверх второго ряда
		vi.advanceTimersByTime(2100)
		await flushPromises()
		expect(wrapper.find('.k7-mycall').text()).toContain('My call link')
		vi.useRealTimers()
		wrapper.unmount()
	})
	test('copy button writes the link to the clipboard', async () => {
		const writeText = vi.fn(() => Promise.resolve())
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		const wrapper = await offerCopy()
		await wrapper.find('.k7-mycall-copy').trigger('click')
		await flushPromises()
		expect(writeText).toHaveBeenCalledWith('https://x/call')
		expect(wrapper.find('.k7-mycall-copy').exists()).toBe(false)
		wrapper.unmount()
	})

	test('copy button without clipboard API falls back to execCommand', async () => {
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
		document.execCommand = vi.fn(() => true)
		const wrapper = await offerCopy()
		await wrapper.find('.k7-mycall-copy').trigger('click')
		await flushPromises()
		expect(document.execCommand).toHaveBeenCalledWith('copy')
		expect(wrapper.find('.k7-mycall-copy').exists()).toBe(false)
		wrapper.unmount()
	})

	test('copy button: all methods fail, link is shown for manual copy', async () => {
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
		document.execCommand = vi.fn(() => {
			throw new Error('no')
		})
		const wrapper = await offerCopy()
		await wrapper.find('.k7-mycall-copy').trigger('click')
		await flushPromises()
		expect(wrapper.find('.k7-mycall-manual').element.value).toBe('https://x/call')
		wrapper.unmount()
	})

	test('focus trap activates once on open and deactivates on close', async () => {
		trap.create.mockClear()
		trap.activate.mockClear()
		trap.deactivate.mockClear()
		const wrapper = await setup(undefined)
		const opener = wrapper.findAll('button').find((b) => b.attributes('variant') === 'primary')
		await opener.trigger('click')
		await opener.trigger('click')
		await flushPromises()
		expect(trap.create).toHaveBeenCalledTimes(1)
		expect(trap.activate).toHaveBeenCalledTimes(1)
		document.getElementById('k7-meet-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await flushPromises()
		expect(trap.deactivate).toHaveBeenCalled()
		wrapper.unmount()
	})
})
