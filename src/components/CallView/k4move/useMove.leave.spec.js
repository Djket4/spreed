/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#177): выход исходной через настоящую цепочку participantsStore.leaveCall → callsService.leaveCall.
// callsService проглатывает ошибку signalingLeaveCall, store всё равно ставит «не в звонке» — moved решает только сервер.
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ peers: [], sent: [], leaveFail: true, store: null }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	signalingJoinCall: vi.fn(),
	signalingSendCallMessage: vi.fn(),
	signalingLeaveCall: vi.fn(async () => {
		if (h.leaveFail) {
			throw new Error('signaling leave failed')
		}
		h.peers = h.peers.filter((p) => p.sessionId !== 'nc-a')
	}),
	k4drawSignaling: () => ({ doSend: (m) => h.sent.push(m.message.data.op), on: () => {}, off: () => {} }),
}))
vi.mock('@nextcloud/axios', () => ({ default: { get: vi.fn(async () => ({ data: { ocs: { data: h.peers } } })) }, isCancel: () => false }))
vi.mock('@nextcloud/dialogs', () => {
	// showInfo — для «Перенос не удался»
	const b = { setText: () => b, setButtons: () => b, build: () => ({ show: () => {} }) }
	return { showError: vi.fn(), showInfo: vi.fn(), showSuccess: vi.fn(), getDialogBuilder: () => b }
})
vi.mock('../k4draw/macBridge.js', () => ({ appPost: vi.fn() }))
// useMove берёт store приложения; здесь это настоящий vuex из participantsStore (создаётся ниже, без подмены dispatch)
vi.mock('../../../store/index.js', () => ({
	default: {
		get getters() {
			return h.store.getters
		},
		dispatch: (...a) => h.store.dispatch(...a),
	},
}))

import { showError, showInfo } from '@nextcloud/dialogs'
import { cloneDeep } from 'es-toolkit'
import { createStore } from 'vuex'
import { PARTICIPANT } from '../../../constants.ts'
import participantsStore from '../../../store/participantsStore.js'
import { useActorStore } from '../../../stores/actor.ts'
import pinia from '../../../stores/pinia.ts'
import { signalingLeaveCall } from '../../../utils/webrtc/index.js'
import { appPost } from '../k4draw/macBridge.js'
import { leaveVerified } from './useMove.js'

const T = 'tok'
const me = { attendeeId: 1, sessionId: 'nc-a' }

describe('выход исходной по серверу, настоящий participantsStore (NAS_CLOUD#177)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setActivePinia(pinia)
		h.store = createStore(cloneDeep(participantsStore))
		const store = h.store
		useActorStore().setCurrentUser({ uid: 'u', displayName: 'U' })
		useActorStore().setCurrentParticipant({ ...me, actorId: 'u', actorType: 'users', participantType: PARTICIPANT.TYPE.USER })
		store.dispatch('addParticipant', { token: T, participant: { ...me, participantType: PARTICIPANT.TYPE.USER, inCall: PARTICIPANT.CALL_FLAG.IN_CALL } })
		store.commit('setInCall', { token: T, sessionId: 'nc-a', flags: PARTICIPANT.CALL_FLAG.IN_CALL })
		h.peers = [{ actorType: 'users', actorId: 'u', sessionId: 'nc-a' }, { actorType: 'users', actorId: 'u', sessionId: 'nc-b' }]
		h.sent = []
	})

	it('signalingLeaveCall упал: store врёт «не в звонке», сервер видит сессию — ошибка, moved и appPost нет', async () => {
		h.leaveFail = true
		expect(h.store.getters.isInCall(T)).toBe(true)
		expect(await leaveVerified('b', 'id1', T, 'nc-b')).toBe(false)
		expect(signalingLeaveCall).toHaveBeenCalledWith(T, false)
		expect(h.store.getters.isInCall(T)).toBe(false) // проглоченная ошибка: store уже «не в звонке»
		expect(showError).toHaveBeenCalled()
		expect(h.sent).toEqual([])
		expect(appPost).not.toHaveBeenCalled()
	})

	it('выход прошёл: сервер сессию не видит — moved получателю и окну', async () => {
		h.leaveFail = false
		expect(await leaveVerified('b', 'id1', T, 'nc-b')).toBe(true)
		expect(h.sent).toEqual(['moved'])
		expect(appPost).toHaveBeenCalledWith('moved')
		expect(showError).not.toHaveBeenCalled()
	})

	it('выход прошёл, но получателя на сервере нет (закрылась): moved и appPost нет, «Перенос не удался»', async () => {
		h.leaveFail = false
		h.peers = h.peers.filter((p) => p.sessionId !== 'nc-b')
		expect(await leaveVerified('b', 'id1', T, 'nc-b')).toBe(false)
		expect(h.sent).toEqual([])
		expect(appPost).not.toHaveBeenCalled()
		expect(showInfo).toHaveBeenCalled()
	})
})
