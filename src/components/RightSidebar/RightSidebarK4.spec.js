/*
 * ket4tec: вкладка «Журнал» только в тест-режиме (NAS_CLOUD#189)
 */

import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createStore } from 'vuex'
import RightSidebar from './RightSidebar.vue'
import storeConfig from '../../store/storeConfig.js'
import { k4stats } from '../../utils/k4stats.js'

vi.mock('@nextcloud/browser-storage', () => {
	const b = { persist: () => b, clearOnLogout: () => b, build: () => ({ getItem: () => null, setItem() {}, removeItem() {} }) }
	return { getBuilder: () => b }
})

vi.mock('../../composables/useGetToken.ts', () => ({ useGetToken: () => ({ value: 'tok' }) }))
vi.mock('../../composables/useIsInCall.js', () => ({ useIsInCall: () => ({ value: true }) }))

vi.mock('../../composables/useGetParticipants.ts', () => ({ useGetParticipants: () => ({}) }))

describe('RightSidebar: вкладка «Журнал»', () => {
	let store
	beforeEach(() => {
		setActivePinia(createPinia())
		store = createStore(storeConfig)
		k4stats.testmode = false
	})

	function mountIt() {
		return shallowMount(RightSidebar, {
			global: { plugins: [store], stubs: { NcAppSidebarTab: { props: ['id'], template: '<div :data-tab="id"><slot /></div>' }, NcAppSidebar: { template: '<div><slot /></div>' } } },
			props: { isInCall: true },
		})
	}

	test('нет при testmode=false', () => {
		expect(mountIt().find('[data-tab="k4-calllog"]').exists()).toBe(false)
	})

	test('есть при testmode=true', () => {
		k4stats.testmode = true
		expect(mountIt().find('[data-tab="k4-calllog"]').exists()).toBe(true)
		k4stats.testmode = false
	})
})
