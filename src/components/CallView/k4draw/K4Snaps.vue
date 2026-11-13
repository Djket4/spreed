<!--
  - ket4tec (NAS_CLOUD#91/#92): вкладка «Файлы» в звонке — снимки доски и картинки из беседы.
  - Тап по превью — «Показать всем»: картинка становится фоном доски у всех (гость видит), рисуют поверх тем же «Рисовать».
-->

<template>
	<div class="k4-snaps">
		<template v-for="g in groups" :key="g.id">
			<h3 v-if="g.items.length">
				{{ g.title }}
			</h3>
			<div v-if="g.items.length" class="k4-snaps__grid">
				<button
					v-for="it in g.items"
					:key="it.t + it.id"
					type="button"
					class="k4-snaps__it"
					:class="{ 'k4-snaps__it--on': state.bg && state.bg.t === it.t && state.bg.id === it.id }"
					:title="it.name"
					:aria-label="'Показать всем: ' + it.name"
					:disabled="busy"
					@click="show(it)">
					<img :src="bgUrl(it, 256)" alt="" loading="lazy">
					<span>Показать всем</span>
				</button>
			</div>
		</template>
		<p v-if="!groups[0].items.length && !groups[1].items.length" class="k4-snaps__empty">
			Снимки доски и картинки из беседы появятся здесь — их можно показать всем и рисовать поверх
		</p>
	</div>
</template>

<script setup>
import axios from '@nextcloud/axios'
import { showError } from '@nextcloud/dialogs'
import { generateOcsUrl } from '@nextcloud/router'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useGetToken } from '../../../composables/useGetToken.ts'
import { SHARED_ITEM } from '../../../constants.ts'
import { useSharedItemsStore } from '../../../stores/sharedItems.ts'
import { useSidebarStore } from '../../../stores/sidebar.ts'
import { bgUrl, canShow, onDraw, showImage, state } from './useDrawing.js'

const props = defineProps({
	active: { type: Boolean, default: false },
})

const token = useGetToken()
const sharedItemsStore = useSharedItemsStore()
const sidebarStore = useSidebarStore()
const snaps = ref([])
const busy = ref(false)

const groups = computed(() => [
	{ id: 's', title: 'Снимки доски', items: snaps.value.map((f) => ({ t: 's', id: f.id, name: f.name })) },
	{
		id: 'm',
		title: 'Картинки из беседы',
		items: Object.values(sharedItemsStore.sharedItems(token.value)[SHARED_ITEM.TYPES.MEDIA] || {})
			.filter((m) => m.messageParameters?.file?.mimetype?.startsWith('image/'))
			.sort((a, b) => b.id - a.id)
			.map((m) => ({ t: 'm', id: +m.id, name: m.messageParameters.file.name })),
	},
])

/** Список снимков доски этого звонка. */
async function load() {
	try {
		const res = await axios.get(generateOcsUrl('apps/spreed/api/v1/k4draw/{token}/snapshots', { token: token.value }))
		snaps.value = res.data?.ocs?.data || []
	} catch (e) {
		console.error('k4draw snapshots', e)
	}
}

watch(() => props.active, (on) => on && load(), { immediate: true })
// снимок сохранили (я или другой участник) — подтянуть список, пока панель открыта
let timer = 0
const off = onDraw((ev) => {
	if (ev.t === 'snap' && props.active) {
		clearTimeout(timer)
		timer = setTimeout(load, 800)
	}
})
onBeforeUnmount(() => {
	off()
	clearTimeout(timer)
})

/**
 * «Показать всем».
 *
 * @param {{ t: string, id: number }} it снимок или картинка из беседы
 */
async function show(it) {
	busy.value = true
	try {
		// сначала дешёвые проверки: отказанный показ не должен открывать картинку гостям
		const denied = canShow({ t: it.t, id: it.id })
		if (denied) {
			showError(denied)
			return
		}
		// сервер отдаёт гостям (у них нет чата) только отмеченное: картинку беседы и снимок; отмечаем после снимка старой доски
		const err = await showImage({ t: it.t, id: it.id }, () => axios.post(generateOcsUrl(it.t === 'm' ? 'apps/spreed/api/v1/k4draw/{token}/image/{id}' : 'apps/spreed/api/v1/k4draw/{token}/snapshot/{id}', { token: token.value, id: it.id })))
		// показано — панель закрываем: картинка во весь экран доски
		err ? showError(err) : sidebarStore.hideSidebar()
	} catch (e) {
		console.error('k4draw show image', e)
		showError('Не получилось показать картинку')
	} finally {
		busy.value = false
	}
}
</script>

<style lang="scss" scoped>
.k4-snaps {
	padding: 4px 0 12px;
	h3 {
		margin: 8px 0 6px;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-maxcontrast);
	}
}
.k4-snaps__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
}
.k4-snaps__it {
	position: relative;
	margin: 0;
	padding: 0;
	aspect-ratio: 4 / 3;
	min-height: 0;
	overflow: hidden;
	border: 0;
	border-radius: 12px;
	background: var(--color-background-dark);
	outline: 1px solid var(--color-border); // белый снимок на белой панели
	outline-offset: -1px;
	cursor: pointer;
	img { width: 100%; height: 100%; object-fit: cover; display: block; }
	span {
		position: absolute;
		inset: auto 6px 6px;
		padding: 4px 8px;
		border-radius: 999px;
		background: #1a1718cc;
		color: #f3eee9;
		font-size: 12px;
		font-weight: 600;
		text-align: center;
	}
	&--on { outline: 2px solid var(--color-primary-element); }
	&:disabled { opacity: .6; }
}
.k4-snaps__empty {
	margin: 8px 0;
	color: var(--color-text-maxcontrast);
}
</style>
