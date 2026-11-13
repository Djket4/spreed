<!--
  - ket4tec: журнал звонка (NAS_CLOUD#189). Вкладка владельца: лента событий с сервера, опрос раз в 3 с, пока вкладка открыта.
-->

<template>
	<div class="k4cl">
		<label class="k4cl-f">
			<input v-model="onlyBad" type="checkbox">
			Только проблемы
		</label>
		<p v-if="!shown.length" class="k4cl-empty">
			Пока ничего нет
		</p>
		<ul class="k4cl-list">
			<li
				v-for="e in shown"
				:key="e.key"
				class="k4cl-row"
				:class="{ 'k4cl-bad': isBad(e) }">
				<span class="k4cl-t">{{ time(e.t) }}</span>
				<b>{{ e.name || 'без имени' }}</b>
				{{ text(e) }}
			</li>
		</ul>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { useGetToken } from '../../../composables/useGetToken.ts'

const MAX = 500
const EVERY = 3000
const BAD = ['rtc_warn', 'join_blocked', 'gum_err', 'js_error']
const WARN = { drop: 'обрыв', loss: 'потери', rtt: 'задержка', jit: 'дрожание звука', novideo: 'нет видео', noaudio: 'нет звука', fps: 'видео рывками', own: 'свой канал' }
const SIG = { open: 'соединение с сервером звонков установлено', close: 'соединение с сервером звонков закрыто', error: 'ОШИБКА соединения с сервером звонков', reconnect: 'переподключение к серверу звонков' }
const mbit = (k) => (k / 1000).toFixed(1).replace('.', ',') + ' Мбит/с'
const has = (v) => v !== undefined && v !== null
const who = (p) => (p === 'local' ? 'свой поток' : 'поток от ' + p)
// тексты по смыслу как client_text в calllog.py (NAS_CLOUD)
const TEXT = {
	page_load: (d) => 'загружена страница звонка' + (has(d.w) && has(d.h) ? `; окно ${d.w}x${d.h}` : ''),
	join_click: (d) => 'нажато «войти в звонок»' + (d.silent ? '; тихий вход' : ''),
	call_joined: () => 'вход в звонок выполнен',
	join_blocked: (d) => `ВХОД В ЗВОНОК НЕ УДАЛСЯ (${d.where}, код ${has(d.code) ? d.code : '—'})`,
	call_left: (d) => 'выход из звонка' + (d.all ? ' (для всех)' : ''),
	gum_ok: (d) => `доступ к устройствам получен (аудиодорожек ${d.a}, видеодорожек ${d.v})`,
	gum_err: (d) => `ОТКАЗ/ОШИБКА устройства: ${d.name} (микрофон: ${d.a ? 'да' : 'нет'}, камера: ${d.v ? 'да' : 'нет'})`,
	signaling: (d) => (SIG[d.st] || 'сервер звонков: ' + d.st) + (has(d.code) ? ` (код ${d.code})` : '') + (d.ms ? `, через ${d.ms} мс` : ''),
	rtc_state: (d) => `WebRTC, ${who(d.peer)}: ${d.st}` + (d.n ? ` (обрывов с начала: ${d.n})` : ''),
	screen_start: () => 'начат показ экрана',
	screen_stop: () => 'показ экрана закончен',
	screen_denied: (d) => 'показ экрана не начат: ' + (d.name || 'отказ'),
	pagehide: () => 'страница закрыта или перезагружается',
	js_error: (d) => `ошибка JS: ${d.name}: ${d.msg}`,
	net: (d) => 'у браузера ' + (d.st === 'online' ? 'появилась сеть' : 'пропала сеть'),
	framing_error: (d) => 'сбой кадрирования по лицу: ' + d.reason,
	rtc_stats: (d) => 'связь: ' + ([
		has(d.up) ? `↑ ${mbit(d.up)} ${d.upl ?? 0}%` : null,
		has(d.dn) ? `↓ ${mbit(d.dn)} ${d.dnl ?? 0}%` : null,
		has(d.rtt) ? `${d.rtt} мс` : null,
		d.path === 'relay' ? 'TURN' : null,
	].filter(Boolean).join(' · ') || 'нет данных'),
	rtc_path: (d) => {
		const ty = [d.lt, d.rt]
		const how = ty.includes('relay') ? 'через ретранслятор TURN' : ty.includes('srflx') ? 'через сервер STUN' : 'напрямую'
		return `путь соединения с ${d.peer}: ${how}` + (d.proto ? ', ' + d.proto : '')
	},
	rtc_warn: (d) => `${d.lvl === 'red' ? 'ПРЕДУПРЕЖДЕНИЕ' : 'предупреждение'} связи с ${d.peer}: ${WARN[d.w] || d.w}` + (d.on ? '' : ' — прошло'),
	board_open: (d) => 'открыта доска' + (d.own ? ' (своя)' : ''),
	board_close: () => 'доска закрыта',
	draw_mode: (d) => 'режим рисования ' + (d.on ? 'включён' : 'выключен'),
	media: (d) => (d.kind === 'a' ? 'микрофон ' : 'камеру ') + (d.on ? 'включил' : d.by === 'host' ? 'выключил ведущий' : 'выключил сам'),
	session: () => 'сессия получена, события до входа относятся к ней',
}

/** `d` из Redis может прийти как [] вместо {} */
const dOf = (e) => (e.d && typeof e.d === 'object' && !Array.isArray(e.d) ? e.d : {})

export default {
	name: 'K4CallLogTab',

	props: {
		/** вкладка выбрана и панель открыта: иначе опроса нет */
		active: {
			type: Boolean,
			default: false,
		},
	},

	setup() {
		return { token: useGetToken() }
	},

	data() {
		return { events: [], onlyBad: false, since: 0, timer: null, seq: 0 }
	},

	computed: {
		shown() {
			return this.onlyBad ? this.events.filter(this.isBad) : this.events
		},
	},

	watch: {
		active: {
			immediate: true,
			handler(on) {
				on ? this.start() : this.stop()
			},
		},
	},

	beforeUnmount() {
		this.stop()
	},

	methods: {
		isBad(e) {
			return BAD.includes(e.k) && !(e.k === 'rtc_warn' && !dOf(e).on)
		},

		time(t) {
			return new Date(t * 1000).toLocaleTimeString('ru-RU')
		},

		text(e) {
			try {
				return Object.hasOwn(TEXT, e.k) ? TEXT[e.k](dOf(e)) : e.k
			} catch {
				return e.k
			}
		},

		start() {
			if (!this.timer) {
				this.poll()
				this.timer = setInterval(this.poll, EVERY)
			}
		},

		stop() {
			clearInterval(this.timer)
			this.timer = null
		},

		async poll() {
			try {
				const { data } = await axios.get(generateOcsUrl('apps/spreed/api/v1/calllog/{token}/feed', { token: this.token }), { params: { since: this.since } })
				const r = data?.ocs?.data ?? data
				if (typeof r?.now === 'number') {
					this.since = r.now
				}
				if (this.timer && r?.events?.length) {
					const add = r.events.map((e) => ({ ...e, key: ++this.seq })).reverse()
					this.events = add.concat(this.events).slice(0, MAX)
				}
			} catch (e) {
				// сеть: молча; 403 — не владелец, опрос не нужен
				if (e.response?.status === 403) {
					this.stop()
				}
			}
		},
	},
}
</script>

<style lang="scss" scoped>
.k4cl {
	padding: 8px;
	font-size: 12px;
}

.k4cl-f {
	display: flex;
	align-items: baseline;
	gap: 6px;
}

.k4cl-list {
	list-style: none;
	margin: 0;
	padding: 0;
}

.k4cl-row {
	padding: 2px 0;
	border-bottom: 1px solid var(--color-border);
}

.k4cl-bad {
	color: var(--color-error-text);
}

.k4cl-t {
	color: var(--color-text-maxcontrast);
	margin-inline-end: 4px;
}

.k4cl-empty {
	color: var(--color-text-maxcontrast);
}
</style>
