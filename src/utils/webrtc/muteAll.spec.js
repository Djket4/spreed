import { describe, expect, test, vi } from 'vitest'
import { muteAllOthers } from './muteAll.js'

const model = (audioAvailable) => ({ attributes: { audioAvailable }, forceMute: vi.fn() })

describe('muteAllOthers', () => {
	test('выключает только тех, у кого микрофон включён', () => {
		const a = model(true)
		const b = model(false)
		const c = model(true)
		expect(muteAllOthers([a, b, c])).toBe(2)
		expect(a.forceMute).toHaveBeenCalledOnce()
		expect(b.forceMute).not.toHaveBeenCalled()
		expect(c.forceMute).toHaveBeenCalledOnce()
	})

	test('пустой список', () => {
		expect(muteAllOthers([])).toBe(0)
	})
})
