/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * ket4tec (NAS_CLOUD#183): ступени возврата после обрыва своего канала (HPB), без действий пользователя.
 * 0 — возобновить ту же сигнальную сессию и перезапустить ICE (остальные ничего не видят);
 * 1 — пересоздать свои соединения в той же сессии;
 * 2 — штатный путь Talk: вход новой сессией (у остальных плитка держится, см. призрак в webrtc.js), дальше раз в 20 с.
 * После каждой ступени ждём K4_WAIT[ступень]: связь вернулась — лестница сброшена, нет — следующая ступень.
 */
export const K4_WAIT = [5000, 6000, 20000]

/**
 * @param {object} p
 * @param {Function} p.up связь есть (сигнальный сокет и свой поток)
 * @param {Function} p.run выполнить ступень (номер 0..2)
 * @return {{go: Function, ok: Function, stop: Function, step: Function}}
 */
export function k4Ladder({ up, run }) {
	let step = 0
	let timer = null
	const go = () => {
		if (timer) {
			return false // ступень уже идёт, её проверка решит, нужна ли следующая
		}
		const s = Math.min(step++, 2)
		timer = setTimeout(() => {
			timer = null
			up() ? (step = 0) : go()
		}, K4_WAIT[s])
		run(s)
		return true
	}
	const stop = () => {
		clearTimeout(timer)
		timer = null
		step = 0
	}
	return {
		go,
		/** связь вернулась раньше проверки */
		ok: () => up() && stop(),
		stop,
		step: () => step,
	}
}
