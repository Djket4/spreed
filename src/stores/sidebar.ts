import { getCurrentUser } from '@nextcloud/auth'
import { emit } from '@nextcloud/event-bus'
/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { defineStore } from 'pinia'
import BrowserStorage from '../services/BrowserStorage.js'

/**
 * Открыта ли панель по умолчанию.
 * ket4tec: гостю — закрыта (имя он вводит в центре комнаты, в панели был дубль), пока сам не откроет
 */
export function sidebarOpenByDefault(): boolean {
	const v = BrowserStorage.getItem('sidebarOpen')
	return v === null ? !!getCurrentUser() : v !== 'false'
}

export const useSidebarStore = defineStore('sidebar', {
	state: () => ({
		show: sidebarOpenByDefault(),
	}),

	actions: {
		showSidebar({ activeTab = '', cache = true }: { activeTab?: string, cache?: boolean } = {}) {
			this.show = true
			if (activeTab) {
				emit('spreed:select-active-sidebar-tab', activeTab)
			}
			if (cache) {
				BrowserStorage.setItem('sidebarOpen', 'true')
			}
		},

		hideSidebar({ cache = true }: { cache?: boolean } = {}) {
			this.show = false
			if (cache) {
				BrowserStorage.setItem('sidebarOpen', 'false')
			}
		},
	},
})
