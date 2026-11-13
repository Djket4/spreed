/*
 * ket4tec (NAS_CLOUD#108): полоса камер при показе на низком окне
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCallViewStore } from '../callView.ts'

vi.mock('../../services/BrowserStorage.js', () => ({ default: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() } }))

const mq = (matches) => vi.stubGlobal('matchMedia', () => ({ matches }))

describe('startPresentation и высота окна', () => {
	beforeEach(() => setActivePinia(createPinia()))
	afterEach(() => vi.unstubAllGlobals())

	it('на низком окне (≤500 px) полоса не открывается принудительно', () => {
		mq(true)
		const s = useCallViewStore()
		s.setCallViewMode({ token: 't', isStripeOpen: false })
		s.startPresentation('t')
		expect(s.isStripeOpen).toBe(false)
	})

	it('на высоком окне полоса открыта, как раньше', () => {
		mq(false)
		const s = useCallViewStore()
		s.setCallViewMode({ token: 't', isStripeOpen: false })
		s.startPresentation('t')
		expect(s.isStripeOpen).toBe(true)
	})
})
