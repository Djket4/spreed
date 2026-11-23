/*
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { showError, showSuccess } from '@nextcloud/dialogs'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createStore } from 'vuex'
import WelcomeView from './WelcomeView.vue'
import ru from '../../l10n/ru.json'
import router from '../__mocks__/router.js'
import { localCapabilities } from '../services/CapabilitiesManager.ts'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@nextcloud/vue/composables/useIsMobile', async () => {
	const { ref } = await import('vue')
	return { useIsMobile: () => ref(mobile.value) }
})
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

describe('WelcomeView.vue (ket4tec NAS_CLOUD#332: четыре кнопки)', () => {
	const LINK = 'https://example.test/call/abc'
	let writeText

	/**
	 * @param {string} link ссылка «Мой звонок» ('' — приложение «Стол» ссылку не дало)
	 */
	async function mountView(link, createGroupConversation = vi.fn()) {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ call: link }) })
		const wrapper = mount(WelcomeView, {
			global: { plugins: [router, createStore({ getters: { getConversationForUser: () => () => null }, actions: { createGroupConversation } })] },
		})
		await flushPromises()
		return wrapper
	}

	const labels = (wrapper) => wrapper.findAll('.talk-dashboard__actions button').map((b) => b.text())

	beforeEach(() => {
		mobile.value = false
		setActivePinia(createPinia())
		localCapabilities.spreed.config.call = { enabled: true }
		localCapabilities.spreed.config.conversations = { 'can-create': true }
		writeText = vi.fn().mockResolvedValue()
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
	})

	afterEach(() => vi.restoreAllMocks())

	test('четыре кнопки при включённых звонках и наличии ссылки', async () => {
		const wrapper = await mountView(LINK)
		expect(labels(wrapper)).toEqual(['Start meeting', 'My call link', 'New conversation', 'Check devices'])
	})

	test('компьютер: значок, заголовок и текст на месте', async () => {
		const wrapper = await mountView(LINK)
		expect(wrapper.find('.empty-content__icon').exists()).toBe(true)
		expect(wrapper.text()).toContain('Выберите обсуждение')
		expect(wrapper.text()).toContain('Откройте обсуждение из списка')
		expect(labels(wrapper)).toHaveLength(4)
	})

	test('телефон: без значка, заголовка и текста, кнопки на месте', async () => {
		mobile.value = true
		const wrapper = await mountView(LINK)
		expect(wrapper.find('.empty-content__icon').exists()).toBe(false)
		expect(wrapper.text()).not.toContain('Выберите обсуждение')
		expect(wrapper.text()).not.toContain('Откройте обсуждение')
		expect(labels(wrapper)).toHaveLength(4)
	})

	test('телефон: короткие подписи, полные в title и aria-label; компьютер: полные', async () => {
		mobile.value = true
		const phone = await mountView(LINK)
		expect(labels(phone)).toEqual(['Start meeting', 'My call link', 'Conversation', 'Check'])
		const full = phone.findAll('.talk-dashboard__actions button').map((b) => b.attributes('aria-label'))
		expect(full).toContain('New conversation')
		expect(full).toContain('Check devices')
		mobile.value = false
		expect(labels(await mountView(LINK))).toEqual(['Start meeting', 'My call link', 'New conversation', 'Check devices'])
	})

	test('короткие подписи телефона переведены', () => {
		expect(['Conversation', 'Check'].map((k) => ru.translations[k])).toEqual(['Обсуждение', 'Проверка'])
	})

	test('подписи кнопок переведены на русский', () => {
		expect(['Start meeting', 'My call link', 'New conversation', 'Check devices'].map((k) => ru.translations[k]))
			.toEqual(['Начать встречу', 'Мой звонок', 'Новое обсуждение', 'Проверка устройств'])
	})

	test('«Мой звонок» скрыт, пока ссылки нет', async () => {
		const wrapper = await mountView('')
		expect(labels(wrapper)).toEqual(['Start meeting', 'New conversation', 'Check devices'])
	})

	test('«Мой звонок» на компьютере копирует ссылку и показывает «Скопировано» на кнопке', async () => {
		const wrapper = await mountView(LINK)
		await wrapper.find('.k7-mycall').trigger('click')
		await flushPromises()
		expect(writeText).toHaveBeenCalledWith(LINK)
		expect(labels(wrapper)).toEqual(['Start meeting', 'Copied', 'New conversation', 'Check devices'])
		expect(showSuccess).not.toHaveBeenCalled()
		wrapper.unmount()
	})

	test('ошибка создания встречи: показана ошибка, необработанных отклонений нет', async () => {
		const unhandled = vi.fn()
		process.on('unhandledRejection', unhandled)
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const wrapper = await mountView(LINK, vi.fn().mockRejectedValue(new Error('boom')))
		await wrapper.find('.talk-dashboard__action').trigger('click')
		await flushPromises()
		await document.querySelector('.k7-meet__btn--primary').click()
		await flushPromises()
		await new Promise((resolve) => setTimeout(resolve, 20))
		process.off('unhandledRejection', unhandled)
		expect(showError).toHaveBeenCalled()
		expect(unhandled).not.toHaveBeenCalled()
		wrapper.unmount()
	})
})
