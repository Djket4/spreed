/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { reactive } from 'vue'
import EmitterMixin from '../../EmitterMixin.js'
import { k4log } from '../../k4log.js'
import { CallParticipantModel } from './CallParticipantModel.js'

/**
 *
 */
export function CallParticipantCollection() {
	this._superEmitterMixin()

	this.callParticipantModels = reactive([])
}

CallParticipantCollection.prototype = {

	/**
	 * @param {object} options параметры модели
	 * @param {object} [instead] ket4tec (NAS_CLOUD#183): модель-призрак, место которой занять (тот же слот сетки)
	 * @return {object} новая модель
	 */
	add(options, instead) {
		const callParticipantModel = new CallParticipantModel(options)
		const at = instead ? this.callParticipantModels.indexOf(instead) : -1
		if (at === -1) {
			this.callParticipantModels.push(callParticipantModel)
		} else {
			clearTimeout(instead.k4hold)
			this.callParticipantModels.splice(at, 1, callParticipantModel)
			this._trigger('remove', [instead])
			instead.destroy()
		}

		k4log('peer.add', { id: options?.peerId, name: options?.name })
		this._trigger('add', [callParticipantModel])

		return callParticipantModel
	},

	get(peerId) {
		return this.callParticipantModels.find(function(callParticipantModel) {
			return callParticipantModel.attributes.peerId === peerId
		})
	},

	remove(peerId) {
		const index = this.callParticipantModels.findIndex(function(callParticipantModel) {
			return callParticipantModel.attributes.peerId === peerId
		})
		if (index !== -1) {
			const callParticipantModel = this.callParticipantModels[index]

			this.callParticipantModels.splice(index, 1)

			k4log('peer.rm', { id: peerId, name: callParticipantModel.attributes.name })
			this._trigger('remove', [callParticipantModel])

			callParticipantModel.destroy()
			return true
		}
		return false
	},

}

EmitterMixin.apply(CallParticipantCollection.prototype)
