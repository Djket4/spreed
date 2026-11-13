<!--
  - SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div
		class="avatar-wrapper"
		:class="avatarClass"
		:style="avatarStyle"
		:data-k4ini="k4ini">
		<NcAvatar
			v-if="isSpecialAvatar"
			:key="(isDarkTheme ? 'dark-' : 'light-') + '_' + id"
			class="avatar"
			:user="id"
			:url="!isFederatedUser ? undefined : avatarUrl"
			:iconClass="iconClass"
			:displayName="name"
			:disableTooltip="disableTooltip"
			disableMenu
			isNoUser
			:hideStatus="!showUserStatus"
			:verboseStatus="false"
			:preloadedUserStatus="preloadedUserStatus ?? {}"
			:size="size">
			<template v-if="characterIcon" #icon>
				<div class="avatar" :class="characterIconClass">
					{{ characterIcon }}
				</div>
			</template>
		</NcAvatar>
		<NcAvatar
			v-else
			:key="id + (isDarkTheme ? '-dark' : '-light') + (k4plain && disableMenu)"
			:user="id"
			:isNoUser="k4plain && disableMenu"
			:displayName="name"
			:menuContainer="menuContainer"
			:disableTooltip="disableTooltip"
			:disableMenu="disableMenu"
			:hideStatus="!showUserStatus"
			:verboseStatus="!showUserStatusCompact"
			:preloadedUserStatus="preloadedUserStatus"
			:size="size" />
		<!-- Override user status for federated users -->
		<span
			v-if="showUserStatus && isFederatedUser"
			class="avatar-wrapper__user-status"
			role="img"
			aria-hidden="false"
			:aria-label="t('spreed', 'Federated user')">
			<WebIcon :size="14" />
		</span>
		<NcLoadingIcon
			v-if="loading"
			:size="size / 2"
			class="loading-avatar" />
	</div>
</template>

<script>
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { useIsDarkTheme } from '@nextcloud/vue/composables/useIsDarkTheme'
import { reactive, ref } from 'vue'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import WebIcon from 'vue-material-design-icons/Web.vue'
import { ATTENDEE, AVATAR } from '../../constants.ts'
import { getUserProxyAvatarOcsUrl } from '../../services/avatarService.ts'

// ket4tec (NAS_CLOUD#109 п.4): у кого нет своей картинки — буква на акценте (k7ui.scss), а не блёклая картинка сервера.
// Где нужно меню контакта (NAS_CLOUD#110 Б5), NcAvatar остаётся «пользователем», букву рисуем поверх его картинки (k4ini + k7ui.scss).
// ponytail: один запрос на пользователя за жизнь страницы (тот же адрес, что грузит NcAvatar, — из кэша браузера); сменили картинку — видно после перезагрузки, как и у NcAvatar
const k4own = reactive({}) // userId -> своя картинка есть (true, пока не узнали)
/**
 * @param {string} id пользователь
 */
function k4plainAvatar(id) {
	if (id && !(id in k4own)) {
		k4own[id] = true
		fetch(generateUrl('/avatar/{id}/64', { id })).then((r) => {
			k4own[id] = r.headers.get('X-NC-IsCustomAvatar') !== '0'
		}).catch(() => {})
	}
	return k4own[id] === false
}

export default {

	name: 'AvatarWrapper',

	components: {
		NcAvatar,
		WebIcon,
		NcLoadingIcon,
	},

	props: {
		token: {
			type: String,
			default: null,
		},

		name: {
			type: String,
			required: true,
		},

		id: {
			type: String,
			default: null,
		},

		source: {
			type: String,
			default: null,
		},

		size: {
			type: Number,
			default: AVATAR.SIZE.DEFAULT,
		},

		condensed: {
			type: Boolean,
			default: false,
		},

		condensedOverlap: {
			type: Number,
			default: 2,
		},

		offline: {
			type: Boolean,
			default: false,
		},

		highlighted: {
			type: Boolean,
			default: false,
		},

		disableTooltip: {
			type: Boolean,
			default: false,
		},

		disableMenu: {
			type: Boolean,
			default: false,
		},

		showUserStatus: {
			type: Boolean,
			default: false,
		},

		showUserStatusCompact: {
			type: Boolean,
			default: false,
		},

		preloadedUserStatus: {
			type: Object,
			default: undefined,
		},

		menuContainer: {
			type: String,
			default: undefined,
		},

		loading: {
			type: Boolean,
			default: false,
		},
	},

	setup() {
		const isDarkTheme = useIsDarkTheme()

		const failed = ref(false)

		return {
			isDarkTheme,
			failed,
		}
	},

	computed: {
		k4plain() {
			return !this.isSpecialAvatar && k4plainAvatar(this.id)
		},

		// буквы как у NcAvatar: первая и первая после последнего пробела
		k4ini() {
			if (!this.k4plain || this.disableMenu) {
				return null
			}
			const f = (this.name.match(/[\p{L}\p{N}\s]/gu) || []).join('').trim()
			const i = f.lastIndexOf(' ')
			return f ? (String.fromCodePoint(f.codePointAt(0)) + (i > 0 ? String.fromCodePoint(f.codePointAt(i + 1)) : '')).toLocaleUpperCase() : '?'
		},

		// Determines which icon is displayed
		iconClass() {
			if (!this.source) {
				return ''
			}
			switch (this.source) {
				case ATTENDEE.ACTOR_TYPE.USERS:
				case ATTENDEE.ACTOR_TYPE.BRIDGED:
					return !this.failed ? '' : 'icon-user'
				case ATTENDEE.ACTOR_TYPE.EMAILS:
					return this.token === 'new' ? 'icon-mail' : !this.hasCustomName ? 'icon-user' : ''
				case ATTENDEE.ACTOR_TYPE.GUESTS:
					return !this.hasCustomName ? 'icon-user' : ''
				case ATTENDEE.ACTOR_TYPE.FEDERATED_USERS:
					return (this.token && !this.failed) ? '' : 'icon-user'
				case ATTENDEE.ACTOR_TYPE.DELETED_USERS:
					return 'icon-user'
				case ATTENDEE.ACTOR_TYPE.PHONES:
					return 'icon-phone'
				case ATTENDEE.ACTOR_TYPE.BOTS:
					return [ATTENDEE.CHANGELOG_BOT_ID, ATTENDEE.SAMPLE_BOT_ID].includes(this.id) ? 'icon-changelog' : ''
				case ATTENDEE.ACTOR_TYPE.CIRCLES:
					return 'icon-team'
				case ATTENDEE.ACTOR_TYPE.GROUPS:
				default:
					return 'icon-contacts'
			}
		},

		characterIconClass() {
			if (this.source === ATTENDEE.ACTOR_TYPE.EMAILS && this.token !== 'new' && this.hasCustomName) {
				return 'guest'
			} else if (this.source === ATTENDEE.ACTOR_TYPE.GUESTS && this.hasCustomName) {
				return 'guest'
			} else if (this.isBot) {
				return 'bot'
			}

			return undefined
		},

		avatarClass() {
			return {
				'avatar-wrapper--dark': this.isDarkTheme,
				'avatar-wrapper--offline': this.offline,
				'avatar-wrapper--condensed': this.condensed,
				'avatar-wrapper--highlighted': this.highlighted,
			}
		},

		avatarStyle() {
			return {
				'--avatar-size': this.size + 'px',
				'--condensed-overlap': this.condensedOverlap,
			}
		},

		isFederatedUser() {
			return this.source === ATTENDEE.ACTOR_TYPE.FEDERATED_USERS
		},

		isBot() {
			return this.source === ATTENDEE.ACTOR_TYPE.BOTS && this.id !== ATTENDEE.CHANGELOG_BOT_ID && this.id !== ATTENDEE.SAMPLE_BOT_ID
		},

		isGuestUser() {
			return [ATTENDEE.ACTOR_TYPE.GUESTS, ATTENDEE.ACTOR_TYPE.EMAILS].includes(this.source)
		},

		hasCustomName() {
			return this.name?.trim() && this.name !== t('spreed', 'Guest')
		},

		characterIcon() {
			if (this.isBot) {
				return '>_'
			}

			if (!this.isGuestUser || !this.hasCustomName || this.token === 'new') {
				return ''
			}
			return this.name?.trim()?.toUpperCase()?.charAt(0) ?? '?'
		},

		avatarUrl() {
			return getUserProxyAvatarOcsUrl(this.token, this.id, this.isDarkTheme, this.size > AVATAR.SIZE.MEDIUM ? 512 : 64)
		},

		isSpecialAvatar() {
			return this.isGuestUser || this.iconClass || this.isBot || (this.isFederatedUser && this.token)
		},
	},

	watch: {
		avatarUrl() {
			this.failed = false
		},
	},

	methods: {
		t,
	},
}
</script>

<style lang="scss" scoped>
.avatar-wrapper {
	position: relative;
	height: var(--avatar-size);
	width: var(--avatar-size);
	border-radius: var(--avatar-size);

	&--dark .avatar {
		background-color: #3B3B3B !important;
	}

	.avatar {
		position: sticky;
		top: 0;
		display: block;
		width: var(--avatar-size);
		height: var(--avatar-size);
		max-height: var(--avatar-size);
		max-width: var(--avatar-size);
		line-height: var(--avatar-size);
		font-size: calc(var(--avatar-size) / 2);
		background-color: var(--color-text-maxcontrast-default);

		& :deep(.avatar-class-icon) {
			background-size: calc(var(--avatar-size) / 2);
			&.icon-changelog {
				background-size: cover !important;
			}
		}

		&.bot {
			padding-inline-start: 5px;
			background-color: var(--color-background-darker);
		}

		&.guest {
			color: #ffffff;
			padding: 0;
			display: block;
			text-align: center;
			margin-inline: auto;
		}
	}

	&--condensed {
		width: unset;
		height: unset;
		margin-inline-start: calc(var(--condensed-overlap) * -1px);
		display: flex;

		& :deep(.avatardiv) {
			outline: 2px solid var(--color-main-background);
		}
	}

	&--offline {
		opacity: .4;

		& :deep(.avatardiv) {
			background: rgba(var(--color-main-background-rgb), .4) !important;
		}
	}

	&--highlighted {
		outline: 2px solid var(--color-primary-element);
	}

	&__user-status {
		position: absolute;
		inset-inline-end: -4px;
		bottom: -4px;
		height: 18px;
		width: 18px;
		border: 2px solid var(--color-main-background);
		background-color: var(--color-main-background);
		border-radius: 50%;
	}
}

.loading-avatar {
	position: absolute;
	top: 0;
	inset-inline-start: 0;
	width: 100%;
	height: 100%;
}

.avatar-wrapper:not(.avatar-wrapper--dark) {
	// FIXME: update the used color in NcAvatar
	// TOREMOVE: when fixed in @nextcloud/vue
	:deep(.avatar-class-icon) {
		background-color: var(--color-text-maxcontrast-default);
	}
}
</style>
