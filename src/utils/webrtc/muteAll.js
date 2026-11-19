/*
 * ket4tec (NAS_CLOUD#154): «Выключить микрофон всем». Тот же канал control/forceMute, что у поштучного.
 * В коллекции только удалённые участники, себя выключить нельзя.
 */

/**
 * @param {Array} models CallParticipantModel[] (callParticipantCollection.callParticipantModels)
 * @return {number} сколько участников выключено
 */
export function muteAllOthers(models) {
	const targets = models.filter((m) => m.attributes.audioAvailable)
	targets.forEach((m) => m.forceMute())
	return targets.length
}
