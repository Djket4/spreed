import { describe, expect, it, vi } from 'vitest'
import { K4_SIMULCAST_CAPS, k4CapSimulcast, k4SimulcastEncodings } from './k4simulcast.js'

describe('k4SimulcastEncodings', () => {
	it('caps low and medium by scaleResolutionDownBy, top untouched', () => {
		const out = k4SimulcastEncodings([
			{ scaleResolutionDownBy: 1, active: true },
			{ scaleResolutionDownBy: 4, active: true },
			{ scaleResolutionDownBy: 2, active: true },
		])
		expect(out[0].maxBitrate).toBeUndefined()
		expect(out[1].maxBitrate).toBe(K4_SIMULCAST_CAPS.low)
		expect(out[2].maxBitrate).toBe(K4_SIMULCAST_CAPS.medium)
		expect(K4_SIMULCAST_CAPS.medium).toBeGreaterThan(K4_SIMULCAST_CAPS.low)
	})
	it('without scale assumes browser order, lowest first', () => {
		const out = k4SimulcastEncodings([{}, {}, {}])
		expect(out.map((e) => e.maxBitrate)).toEqual([K4_SIMULCAST_CAPS.low, K4_SIMULCAST_CAPS.medium, undefined])
	})
	it('returns null when nothing to change or not 3 layers', () => {
		expect(k4SimulcastEncodings(undefined)).toBeNull()
		expect(k4SimulcastEncodings([{}])).toBeNull()
		expect(k4SimulcastEncodings([{ maxBitrate: K4_SIMULCAST_CAPS.low }, { maxBitrate: K4_SIMULCAST_CAPS.medium }, {}])).toBeNull()
	})
	it('does not mutate input', () => {
		const inp = [{}, {}, {}]
		k4SimulcastEncodings(inp)
		expect(inp[0].maxBitrate).toBeUndefined()
	})
})

describe('k4CapSimulcast', () => {
	const pcWith = (encodings, setParameters = vi.fn(async () => {})) => {
		const sender = { track: { kind: 'video' }, getParameters: () => ({ encodings }), setParameters }
		return { pc: { getSenders: () => [{ track: { kind: 'audio' } }, sender] }, setParameters }
	}
	it('sets parameters on the video sender', async () => {
		const { pc, setParameters } = pcWith([{}, {}, {}])
		expect(await k4CapSimulcast(pc)).toBe(true)
		expect(setParameters.mock.calls[0][0].encodings[1].maxBitrate).toBe(K4_SIMULCAST_CAPS.medium)
	})
	it('skips single-layer video and missing sender', async () => {
		const { pc, setParameters } = pcWith([{}])
		expect(await k4CapSimulcast(pc)).toBe(false)
		expect(setParameters).not.toHaveBeenCalled()
		expect(await k4CapSimulcast({ getSenders: () => [] })).toBe(false)
	})
	it('swallows setParameters errors', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const { pc } = pcWith([{}, {}, {}], vi.fn(async () => {
			throw new Error('InvalidModificationError')
		}))
		expect(await k4CapSimulcast(pc)).toBe(false)
		warn.mockRestore()
	})
})
