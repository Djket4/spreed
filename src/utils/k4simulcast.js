/**
 * NAS_CLOUD#375: потолки битрейта слоёв simulcast для Chrome/Safari (simulcast через SDP munging).
 * Без потолков libwebrtc под общим лимитом HPB (2,5 Мбит/с) сначала наполняет нижние слои по своим целям
 * (270p ~330–550, 540p ~1100), и верхний 1080p получает меньше среднего (~820 кбит/с) — в крупном виде мыло.
 * Нижнему и среднему ставим потолок, верхний не трогаем: ему достаётся остаток бюджета.
 */
export const K4_SIMULCAST_CAPS = { low: 150000, medium: 800000 }

/**
 * Вернуть encodings с потолками для трёх слоёв simulcast или null, если менять нечего.
 * Порядок слоёв — по scaleResolutionDownBy (больше = ниже), без него — как отдаёт браузер (нижний первым).
 *
 * @param {Array<object>|undefined} encodings из RTCRtpSender.getParameters()
 * @return {Array<object>|null}
 */
export function k4SimulcastEncodings(encodings) {
	if (!Array.isArray(encodings) || encodings.length !== 3) {
		return null
	}
	const order = encodings.every((e) => typeof e.scaleResolutionDownBy === 'number')
		? [...encodings.keys()].sort((a, b) => encodings[b].scaleResolutionDownBy - encodings[a].scaleResolutionDownBy)
		: [0, 1, 2]
	const caps = [K4_SIMULCAST_CAPS.low, K4_SIMULCAST_CAPS.medium]
	let changed = false
	const out = encodings.map((e) => ({ ...e }))
	caps.forEach((cap, k) => {
		const e = out[order[k]]
		if (e.maxBitrate !== cap) {
			e.maxBitrate = cap
			changed = true
		}
	})
	return changed ? out : null
}

/**
 * Применить потолки к видеоотправителю камеры. Ошибки не роняют звонок.
 *
 * @param {RTCPeerConnection} pc соединение отправителя
 * @return {Promise<boolean>} true, если параметры изменены
 */
export async function k4CapSimulcast(pc) {
	const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video')
	if (!sender) {
		return false
	}
	try {
		const par = sender.getParameters()
		const enc = k4SimulcastEncodings(par.encodings)
		if (!enc) {
			return false
		}
		par.encodings = enc
		await sender.setParameters(par)
		return true
	} catch (e) {
		console.warn('k4 simulcast caps failed', e)
		return false
	}
}
