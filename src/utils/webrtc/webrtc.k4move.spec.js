/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#177): настоящий обработчик message из initWebRtc вне звонка не портит k4move для слушателей после него.
import { describe, expect, it, vi } from 'vitest'

// SimpleWebRTC — пустышка на любой вызов: нужен только обработчик сигналинга из initWebRtc
vi.mock('./simplewebrtc/simplewebrtc.js', () => {
	const stub = () => new Proxy(function() {}, { get: (o, k) => (k === 'then' ? undefined : stub()), apply: () => stub() })
	return {
		default: function() {
			return stub()
		},
	}
})

describe('webrtc.js: фильтр сообщений вне звонка', () => {
	it('k4move проходит к следующему слушателю с исходным типом, остальное — message-to-ignore', async () => {
		const { initWebRtc } = await import('./webrtc.js')
		const handlers = {}
		const signaling = { // порядок вызова как в signaling.js: on → push, _trigger → по порядку
			on: (ev, fn) => (handlers[ev] ??= []).push(fn),
			off: () => {},
			emit: () => {},
			hasFeature: () => false,
			getSessionId: () => 'me',
		}
		initWebRtc(signaling, { callParticipantModels: [] }, {})
		const seen = []
		signaling.on('message', (m) => seen.push(m.type)) // слушатель useMove регистрируется после webrtc.js
		const fire = (m) => handlers.message.forEach((fn) => fn(m))
		fire({ type: 'k4move', v: 2, op: 'accept', id: 'x', from: 'b' })
		fire({ type: 'offer', from: 'b' })
		expect(seen).toEqual(['k4move', 'message-to-ignore'])
	})
})
