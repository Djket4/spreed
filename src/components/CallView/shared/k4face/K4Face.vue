<!--
  ket4tec: плитка без камеры — облако синапсов, слушает голос участника (движок — face.js)
-->
<template>
	<div class="k4face" :style="{ '--c': color }" aria-hidden="true">
		<canvas ref="cv" />
	</div>
</template>

<script>
import { markRaw } from 'vue'
import { draw, face, join, leave, probe, setRoster } from './face.js'

export default {
	name: 'K4Face',
	props: {
		stream: { type: Object, default: null },
		on: { type: Boolean, default: true },
		seed: { type: String, default: '' },
		token: { type: String, default: '' },
	},

	data() {
		return { f: markRaw(face(this.seed)), color: 'transparent' }
	},

	computed: {
		// весь звонок из списка участников: так у всех одинаково, даже если плитка на другой странице сетки
		roster() {
			return (this.$store?.getters.participantsList(this.token) || [])
				.filter((a) => a.inCall && a.actorType && a.actorId)
				.map((a) => [a.actorType + '/' + a.actorId, a.attendeeId])
		},
	},

	watch: {
		roster: { immediate: true, handler: setRoster },
		stream() { this.attach() },
		seed(v, old) {
			leave(old)
			join(v)
			this.f = markRaw(face(v))
		},
	},

	mounted() {
		this.src = null
		this.vis = true
		this.last = 0
		join(this.seed)
		this.attach()
		this.ro = new ResizeObserver(() => this.size())
		this.ro.observe(this.$el)
		this.io = new IntersectionObserver(([e]) => {
			this.vis = e.isIntersecting
			this.loop()
		})
		this.io.observe(this.$el)
		this.size()
		this.loop()
	},

	beforeUnmount() {
		cancelAnimationFrame(this.raf)
		this.raf = 0
		this.ro.disconnect()
		this.io.disconnect()
		this.src?.stop()
		leave(this.seed)
	},

	methods: {
		attach() {
			this.src?.stop()
			try {
				this.src = probe(this.stream)
			} catch (e) {
				this.src = null // нет WebAudio — облако без звука
			}
		},

		size() {
			const cv = this.$refs.cv
			const r = this.$el.getBoundingClientRect()
			const k = Math.min(window.devicePixelRatio || 1, 1.5) // ponytail: потолок 1.5 — на iPhone DPR 3 холст в 4 раза дороже, глазу не видно
			cv.width = Math.max(1, Math.round(r.width * k))
			cv.height = Math.max(1, Math.round(r.height * k))
		},

		loop() {
			if (this.raf || !this.vis) {
				return
			}
			const tick = (t) => {
				this.raf = 0
				if (!this.vis || !this.$refs.cv) {
					return
				}
				const dt = Math.min(0.1, (t - this.last) / 1000)
				if (dt >= 1 / 25) { // ~24 кадра в секунду на плитку: камеры не должны дёргаться из-за облаков
					this.last = t
					const cv = this.$refs.cv
					draw(cv.getContext('2d'), cv.width, cv.height, this.f, this.src, this.on, dt)
					if (this.color !== this.f.color) {
						this.color = this.f.color
					}
				}
				this.raf = requestAnimationFrame(tick)
			}
			this.raf = requestAnimationFrame(tick)
		},
	},
}
</script>

<style scoped>
.k4face {
	position: absolute;
	inset: 0;
	background: radial-gradient(62% 62% at 50% 44%, color-mix(in srgb, var(--c) 16%, #0a0c12), #05060a 80%);
}

.k4face canvas {
	width: 100%;
	height: 100%;
	display: block;
}
</style>
