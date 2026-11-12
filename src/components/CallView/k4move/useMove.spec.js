/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#113): другая сессия того же пользователя и фильтр ссылок шапки
import { describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/dialogs', () => ({ getDialogBuilder: vi.fn(), showInfo: vi.fn() }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (u) => '/index.php' + u }))
vi.mock('../../../store/index.js', () => ({ default: { getters: {} } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({}) }))
vi.mock('../../../stores/session.ts', () => ({ useSessionStore: () => ({}) }))
vi.mock('../../../stores/token.ts', () => ({ useTokenStore: () => ({}) }))
vi.mock('../../../utils/webrtc/index.js', () => ({ k4drawSignaling: () => null }))

import { headerLinkToOpen, isTrustedTake, otherSessionsInCall } from './useMove.js'

describe('другая сессия в звонке', () => {
	const S = [
		{ token: 't', attendeeId: 1, signalingSessionId: 'me', inCall: 0 },
		{ token: 't', attendeeId: 1, signalingSessionId: 'old', inCall: 7 },
		{ token: 't', attendeeId: 1, signalingSessionId: 'idle', inCall: 0 },
		{ token: 't', attendeeId: 2, signalingSessionId: 'other', inCall: 7 },
		{ token: 'x', attendeeId: 1, signalingSessionId: 'room2', inCall: 7 },
	]
	it('находит только свою, в этой комнате, в звонке', () => {
		expect(otherSessionsInCall(S, 't', 1, 'me')).toEqual(['old'])
		expect(otherSessionsInCall(S, 't', 3, 'me')).toEqual([])
	})
	it('take доверяем только от своей сессии и не гостю', () => {
		expect(isTrustedTake(S[1], 1, 'users', 't')).toBe(true)
		expect(isTrustedTake(S[3], 1, 'users', 't')).toBe(false)
		expect(isTrustedTake(S[1], 1, 'guests', 't')).toBe(false)
		expect(isTrustedTake(undefined, 1, 'users', 't')).toBe(false)
	})
})

describe('ссылки шапки', () => {
	const mk = (href, extra = {}) => {
		document.body.innerHTML = `<div id="header"><a id="a" href="${href}"><span id="s">x</span></a></div>`
		return { button: 0, target: document.getElementById('s'), ...extra }
	}
	const O = 'https://h.test'
	const here = '/index.php/call/abc'
	const app = '/index.php/apps/spreed'
	it('другое приложение — в новую вкладку', () => {
		expect(headerLinkToOpen(mk('/index.php/apps/files/'), O, here, app)).toBe(O + '/index.php/apps/files/')
	})
	it('не трогает приложение звонков, якорь, ctrl, среднюю кнопку, чужой сайт', () => {
		expect(headerLinkToOpen(mk('/index.php/apps/spreed/'), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('#x'), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('/index.php/apps/files/', { ctrlKey: true }), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('/index.php/apps/files/', { button: 1 }), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('https://ext.test/'), O, here, app)).toBeNull()
	})
})
