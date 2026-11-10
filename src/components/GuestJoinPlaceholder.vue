<!--
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<!-- ket4tec v7: пустое место гостя вместо скрытого чата — название, имя, «Войти в звонок» -->
<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from 'vuex'
import SetGuestUsername from './SetGuestUsername.vue'
import CallButton from './TopBar/CallButton.vue'
import { useGetToken } from '../composables/useGetToken.ts'

const store = useStore()
const token = useGetToken()
const roomName = computed<string>(() => store.getters.conversation(token.value)?.displayName ?? '')
</script>

<template>
	<div class="guest-join">
		<h2 class="guest-join__name">
			{{ roomName }}
		</h2>
		<SetGuestUsername compact class="guest-join__username" />
		<!-- та же кнопка, что в шапке: те же проверки и joinCall -->
		<CallButton class="guest-join__button" label="Войти в звонок" />
	</div>
</template>

<style lang="scss" scoped>
.guest-join {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 20px;
	padding: 24px 16px;
	box-sizing: border-box;
	color: var(--k7-fg, #f3eee9);

	&__name {
		margin: 0;
		max-width: 100%;
		text-align: center;
		font-size: clamp(22px, 4.5vw, 30px);
		line-height: 1.15;
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	&__username {
		width: min(100%, 420px);
	}

	// ket4tec v7: большая кнопка; перебиваем размеры кнопки шапки
	&__button :deep(.button-vue),
	&__button.button-vue {
		min-width: min(100%, 260px);
		min-height: 56px;
		font-size: 18px;
		font-weight: 600;
		border-radius: 999px;
	}
}
</style>
