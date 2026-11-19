/*
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { showSuccess } from '@nextcloud/dialogs'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createStore } from 'vuex'
import WelcomeView from './WelcomeView.vue'
import ru from '../../l10n/ru.json'
import router from '../__mocks__/router.js'
import { localCapabilities } from '../services/CapabilitiesManager.ts'

vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

describe('WelcomeView.vue (ket4tec NAS_CLOUD#332: четыре кнопки)', () => {
	const LINK = 'https://example.test/call/abc'
	let writeText

	/**
	 * @param {string} link ссылка «Мой звонок» ('' — приложение «Стол» ссылку не дало)
	 */
	async function mountView(link) {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ call: link }) })
		const wrapper = mount(WelcomeView, {
			global: { plugins: [router, createStore({ getters: { getConversationForUser: () => () => null } })] },
		})
		await flushPromises()
		return wrapper
	}

	const labels = (wrapper) => wrapper.findAll('.talk-dashboard__actions button').map((b) => b.text())

	beforeEach(() => {
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

	test('подписи кнопок переведены на русский', () => {
		expect(['Start meeting', 'My call link', 'New conversation', 'Check devices'].map((k) => ru.translations[k]))
			.toEqual(['Начать встречу', 'Мой звонок', 'Новое обсуждение', 'Проверка устройств'])
	})

	test('«Мой звонок» скрыт, пока ссылки нет', async () => {
		const wrapper = await mountView('')
		expect(labels(wrapper)).toEqual(['Start meeting', 'New conversation', 'Check devices'])
	})

	test('«Мой звонок» на компьютере кладёт ссылку в буфер', async () => {
		const wrapper = await mountView(LINK)
		await wrapper.find('.k7-mycall').trigger('click')
		await flushPromises()
		expect(writeText).toHaveBeenCalledWith(LINK)
		expect(showSuccess).toHaveBeenCalled()
	})
})
