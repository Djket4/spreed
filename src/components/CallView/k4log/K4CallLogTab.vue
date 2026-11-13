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
const KIND = {
	page_load: 'открыл страницу звонка',
	pagehide: 'закрыл страницу',
	join_click: 'нажал «войти в звонок»',
	join_blocked: 'не смог войти в звонок',
	call_joined: 'вошёл в звонок',
	call_left: 'вышел из звонка',
	gum_ok: 'дал доступ к камере и микрофону',
	gum_err: 'не получил камеру или микрофон',
	signaling: 'связь с сервером звонков',
	rtc_state: 'состояние связи',
	rtc_stats: 'связь',
	rtc_path: 'путь связи',
	rtc_warn: 'предупреждение',
	board_open: 'открыл доску',
	board_close: 'закрыл доску',
	draw_mode: 'рисование',
	media: 'микрофон или камера',
	session: 'новая сессия',
	screen_start: 'начал показ экрана',
	screen_stop: 'закончил показ экрана',
	net: 'сеть браузера',
	js_error: 'ошибка в браузере',
}

export default {
	name: 'K4CallLogTab',

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

	mounted() {
		this.poll()
		this.timer = setInterval(this.poll, EVERY)
	},

	beforeUnmount() {
		clearInterval(this.timer)
		this.timer = null
	},

	methods: {
		isBad(e) {
			return BAD.includes(e.k) && !(e.k === 'rtc_warn' && e.d?.on === 0)
		},

		time(t) {
			return new Date(t * 1000).toLocaleTimeString('ru-RU')
		},

		text(e) {
			const d = e.d && typeof e.d === 'object' ? e.d : {}
			return (KIND[e.k] || e.k) + (d.w ? ': ' + d.w : '') + (d.lvl ? ' (' + d.lvl + ')' : '')
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
				// 403 и сеть: молча, вкладку прячет testmode
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
