/*
 * ket4tec: плашка связи в плитках полосы доски (NAS_CLOUD#189)
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('DrawBoard: плашка в полосе', () => {
	test('плитка полосы содержит K4TileStats с ключом local/peerId', () => {
		const src = readFileSync('src/components/CallView/k4draw/DrawBoard.vue', 'utf8')
		expect(src).toContain(`<K4TileStats :peerId="p.me ? 'local' : p.id" compact />`)
		expect(src).toMatch(/id: a\.peerId/)
	})
})
