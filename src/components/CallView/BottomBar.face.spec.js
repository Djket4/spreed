/**
 * ket4tec (NAS_CLOUD#43): кнопка автокадрирования — только на широком экране
 */
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'
import BottomBar from './BottomBar.vue'

vi.mock('../../utils/webrtc/index.js', async (importOriginal) => ({
	...(await importOriginal()),
	localCallParticipantModel: { attributes: {}, on: vi.fn(), off: vi.fn() },
	localMediaModel: { attributes: {}, on: vi.fn(), off: vi.fn() },
	callParticipantCollection: { on: vi.fn(), off: vi.fn() },
}))
vi.mock('vuex', async (importOriginal) => ({
	...(await importOriginal()),
	useStore: () => ({ getters: { conversation: () => ({ type: 2, token: 'tok' }), dummyConversation: {} } }),
}))
vi.mock('../../composables/useGetToken.ts', () => ({ useGetToken: () => ref('tok') }))
vi.mock('../../composables/useIsInCall.js', () => ({ useIsInCall: () => ref(true) }))

function setWidth(phone) {
	window.matchMedia = vi.fn().mockImplementation((query) => ({
		matches: phone && query.includes('max-width: 768px'),
		media: query,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
	}))
}

function mountBar() {
	return shallowMount(BottomBar, {
		props: { isSidebar: false },
		global: { stubs: { NcPopover: { template: '<div class="popover-stub"><slot name="trigger" /></div>' }, NcButton: { template: '<button :class="$attrs.class"><slot /></button>' } } },
	})
}

describe('BottomBar: кнопка автокадрирования', () => {
	beforeEach(() => setActivePinia(createPinia()))
	afterEach(() => vi.restoreAllMocks())

	test('на телефоне её нет', () => {
		setWidth(true)
		expect(mountBar().find('.k7-face-btn').exists()).toBe(false)
	})

	test('на широком экране есть', () => {
		setWidth(false)
		expect(mountBar().find('.k7-face-btn').exists()).toBe(true)
	})
})
