/**
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
	computeSquareLayout as k4Square,
	phoneBarOverlaps,
	computePhoneLayout,
	computeRowDistribution,
	computeSquareLayout,
	PHONE_LANDSCAPE_MIN_SIDE,
	computeTilePlacements,
	getHalfColumnCount,
	getHalfColumnMinWidth,
	getJustifyContent,
	getMinTileHeight,
	getMinTileWidth,
	GRID_GAP,
	MIN_TILE_SIDE,
	STRIPE_HEIGHT,
	TARGET_ASPECT_RATIO,
	TILE_COLUMN_SPAN,
} from './gridLayout.ts'

describe('gridLayout', () => {
	describe('tile size helpers', () => {
		test('uses the larger tile sizes for the full grid', () => {
			expect(getMinTileWidth(false)).toBe(320)
			expect(getMinTileHeight(false)).toBe(240)
		})

		test('uses the compact tile sizes for stripe/sidebar', () => {
			expect(getMinTileWidth(true)).toBe(200)
			expect(getMinTileHeight(true)).toBe(134)
		})

		test('fits a compact tile in the stripe', () => {
			// The grid of the stripe is padded by a gap at its top and bottom
			expect(getMinTileHeight(true)).toBe(STRIPE_HEIGHT - 2 * GRID_GAP)
		})
	})

	// ket4tec (NAS_CLOUD#159): iPhone вертикально, область между шапкой и нижней панелью ~ 440x460
	describe('phone portrait', () => {
		const area = { gridWidth: 440, gridHeight: 460 }

		test.each([
			[1, 1, 1],
			[2, 1, 2],
			[3, 2, 2],
			[4, 2, 2],
			[5, 2, 3],
			[6, 2, 3],
			[9, 2, 3], // 7+: на экране шесть мест, остальное - «+N»
		])('%i tiles: %i column(s) x %i row(s)', (total, columns, rows) => {
			const layout = computePhoneLayout({ ...area, total })
			expect({ columns: layout.columns, rows: layout.rows }).toEqual({ columns, rows })
			// всё помещается и занимает всю высоту, пока плитка не выше 3:4
			expect(layout.columns * layout.side + (layout.columns - 1) * GRID_GAP).toBeLessThanOrEqual(area.gridWidth)
			expect(layout.rows * layout.tileHeight + (layout.rows - 1) * GRID_GAP).toBeLessThanOrEqual(area.gridHeight)
			expect(layout.tileHeight).toBeLessThanOrEqual(layout.side * 4 / 3)
		})

		test('two participants: two tiles one under the other, full width and the whole height', () => {
			const { side, tileHeight } = computePhoneLayout({ ...area, total: 2 })
			expect(side).toBe(440)
			expect(2 * tileHeight + GRID_GAP).toBe(460)
		})

		test('six tiles fill the height of the area', () => {
			const { tileHeight } = computePhoneLayout({ ...area, total: 6 })
			expect(3 * tileHeight + 2 * GRID_GAP).toBeGreaterThanOrEqual(area.gridHeight - 2)
		})

		test('a tall screen does not stretch a tile beyond 3:4', () => {
			const { side, tileHeight } = computePhoneLayout({ gridWidth: 440, gridHeight: 1200, total: 4 })
			expect(tileHeight).toBe(Math.floor(side * 4 / 3))
		})

		test('the square layout with the default minimum leaves only two rows (the old bug)', () => {
			expect(computeSquareLayout({ ...area, total: 5 }).rows).toBe(2)
		})
	})

	describe('computeSquareLayout', () => {
		test('lays out square tiles that fit the area', () => {
			const { columns, rows, side } = computeSquareLayout({ gridWidth: 1920, gridHeight: 1080, total: 4 })
			expect(columns * rows).toBeGreaterThanOrEqual(4)
			expect(side).toBeLessThanOrEqual(1080)
			expect(columns * side + (columns - 1) * GRID_GAP).toBeLessThanOrEqual(1920)
			expect(rows * side + (rows - 1) * GRID_GAP).toBeLessThanOrEqual(1080)
		})

		test('keeps one tile for an empty call', () => {
			expect(computeSquareLayout({ gridWidth: 1920, gridHeight: 1080, total: 0 }).columns).toBe(1)
		})

		test('uses the biggest side when the tiles overflow into pages', () => {
			const { columns, rows, side } = computeSquareLayout({ gridWidth: 1920, gridHeight: 1080, total: 100 })
			expect(side).toBeGreaterThanOrEqual(MIN_TILE_SIDE)
			expect(columns * rows).toBeLessThan(100)
		})

		test('leaves room for the local tile and one participant in a tiny area (NAS_CLOUD#159)', () => {
			// 300x250 fits a single minimal square, but 2 tiles (local + 1 participant) must be shown
			const { columns, rows, side } = computeSquareLayout({ gridWidth: 300, gridHeight: 250, total: 2 })
			expect(columns * rows - 1).toBeGreaterThanOrEqual(1)
			expect(side).toBeGreaterThan(0)
			expect(columns * side + (columns - 1) * GRID_GAP).toBeLessThanOrEqual(300)
			expect(rows * side + (rows - 1) * GRID_GAP).toBeLessThanOrEqual(250)
		})

		test('does not force a second cell when only the local tile is laid out', () => {
			const { columns, rows } = computeSquareLayout({ gridWidth: 300, gridHeight: 250, total: 1 })
			expect(columns * rows).toBe(1)
		})
	})

	describe('computeRowDistribution', () => {
		test('spreads the tiles evenly across the rows', () => {
			expect(computeRowDistribution({ totalTiles: 7, rows: 3 })).toEqual([2, 3, 2])
			expect(computeRowDistribution({ totalTiles: 9, rows: 3 })).toEqual([3, 3, 3])
			expect(computeRowDistribution({ totalTiles: 13, rows: 4 })).toEqual([3, 4, 3, 3])
			expect(computeRowDistribution({ totalTiles: 14, rows: 4 })).toEqual([3, 4, 4, 3])
		})

		test('keeps a single row untouched', () => {
			expect(computeRowDistribution({ totalTiles: 4, rows: 1 })).toEqual([4])
		})

		test('never leaves a row empty', () => {
			expect(computeRowDistribution({ totalTiles: 2, rows: 4 })).toEqual([1, 1])
			expect(computeRowDistribution({ totalTiles: 0, rows: 3 })).toEqual([])
			expect(computeRowDistribution({ totalTiles: 3, rows: 0 })).toEqual([])
		})

		test('lays out every tile in rows of an even size', () => {
			for (let rows = 1; rows <= 6; rows++) {
				for (let totalTiles = 1; totalTiles <= 30; totalTiles++) {
					const distribution = computeRowDistribution({ totalTiles, rows })

					// Every tile is laid out, and no row is left empty
					expect(distribution.reduce((sum, size) => sum + size, 0)).toBe(totalTiles)
					expect(distribution.length).toBe(Math.min(rows, totalTiles))
					// The rows differ by at most one tile
					expect(Math.max(...distribution) - Math.min(...distribution)).toBeLessThanOrEqual(1)
					// The first row is the last one to receive an extra tile, so the
					// fuller rows sit below it
					if (totalTiles % distribution.length !== 0) {
						expect(distribution[0]).toBe(Math.min(...distribution))
					}
				}
			}
		})
	})

	describe('half column helpers', () => {
		test('splits every tile column in two', () => {
			expect(TILE_COLUMN_SPAN).toBe(2)
			expect(getHalfColumnCount(4)).toBe(8)
			expect(getHalfColumnCount(0)).toBe(0)
		})

		test('sizes a half column so that a tile spanning two keeps its minimum width', () => {
			// A tile spans two half columns and the gap between them
			expect(getHalfColumnMinWidth(320) * 2 + GRID_GAP).toBe(320)
		})

		test('never returns a negative half column width', () => {
			expect(getHalfColumnMinWidth(0)).toBe(0)
		})
	})

	describe('computeTilePlacements', () => {
		// A 4 columns grid, laid out as 8 half columns
		const grid = { columns: 4 }

		test('fills a complete grid from the first half column', () => {
			expect(computeTilePlacements({ ...grid, rows: 2, totalTiles: 8 })).toEqual([
				{ row: 1, column: 1 },
				{ row: 1, column: 3 },
				{ row: 1, column: 5 },
				{ row: 1, column: 7 },
				{ row: 2, column: 1 },
				{ row: 2, column: 3 },
				{ row: 2, column: 5 },
				{ row: 2, column: 7 },
			])
		})

		test('shifts a row by a half column when it leaves an odd number of columns empty', () => {
			// 7 tiles in a 4 columns grid: full row on top, 3 tiles last and centered
			expect(computeTilePlacements({ ...grid, rows: 2, totalTiles: 7 })).toEqual([
				{ row: 1, column: 1 },
				{ row: 1, column: 3 },
				{ row: 1, column: 5 },
				{ row: 1, column: 7 },
				{ row: 2, column: 2 },
				{ row: 2, column: 4 },
				{ row: 2, column: 6 },
			])
		})

		test('centers a row leaving an even number of columns empty', () => {
			// 10 tiles in a 4 columns grid: 4, 4 and 2 tiles
			expect(computeTilePlacements({ columns: 4, rows: 3, totalTiles: 10 }).slice(8)).toEqual([
				{ row: 3, column: 3 },
				{ row: 3, column: 5 },
			])
		})

		test('falls back to the default placement when there is nothing to lay out', () => {
			expect(computeTilePlacements({ ...grid, rows: 2, totalTiles: 0 })).toEqual([])
			expect(computeTilePlacements({ ...grid, rows: 0, totalTiles: 4 })).toEqual([])
			expect(computeTilePlacements({ columns: 0, rows: 0, totalTiles: 4 })).toEqual([])
		})

		test('falls back to the default placement when the grid is too small', () => {
			expect(computeTilePlacements({ ...grid, rows: 2, totalTiles: 9 })).toEqual([])
		})

		test('keeps every row inside the grid and centered', () => {
			for (let columns = 1; columns <= 5; columns++) {
				const halfColumns = getHalfColumnCount(columns)

				for (let rows = 1; rows <= 5; rows++) {
					for (let totalTiles = 1; totalTiles <= columns * rows; totalTiles++) {
						const placements = computeTilePlacements({ columns, rows, totalTiles })
						expect(placements.length).toBe(totalTiles)

						// полные ряды сверху, неполный последний
						const distribution = Array.from({ length: Math.ceil(totalTiles / columns) }, (_, r) => Math.min(columns, totalTiles - r * columns))
						for (const [index, rowSize] of distribution.entries()) {
							const row = placements.filter((placement) => placement.row === index + 1)
							expect(row.length).toBe(rowSize)

							// The tiles of the row are laid out one after the other, every
							// tile spanning TILE_COLUMN_SPAN half columns
							const columnsOfRow = row.map((placement) => placement.column)
							expect(columnsOfRow).toEqual(Array.from({ length: rowSize }, (_, i) => columnsOfRow[0] + i * TILE_COLUMN_SPAN))

							// The row stays within the half columns of the grid
							const firstLine = columnsOfRow[0]
							const lastLine = columnsOfRow[rowSize - 1] + TILE_COLUMN_SPAN
							expect(firstLine).toBeGreaterThanOrEqual(1)
							expect(lastLine).toBeLessThanOrEqual(halfColumns + 1)

							// The half columns left empty are split evenly on both sides
							expect(firstLine - 1).toBe(halfColumns + 1 - lastLine)
						}
					}
				}
			}
		})
	})

	describe('rows of the square layout (NAS_CLOUD#159)', () => {
		// страница вмещает columns*rows мест; в неё попадает не больше мест, чем плиток (иначе - листание)
		const rowsOf = (width: number, height: number, total: number) => {
			const { columns, rows: layoutRows, side } = computeSquareLayout({ gridWidth: width, gridHeight: height, total })
			const shown = Math.min(total, columns * layoutRows)
			const placements = computeTilePlacements({ totalTiles: shown, rows: layoutRows, columns })
			const rows: number[] = []
			for (const { row } of placements) {
				rows[row - 1] = (rows[row - 1] ?? 0) + 1
			}
			return { columns, layoutRows, shown, side, rows, placements }
		}

		test.each([[1512, 800], [1180, 820], [820, 1180], [390, 700]])('%ix%i: side is the best of all column counts, last row is the incomplete one', (w, h) => {
			for (let n = 1; n <= 12; n++) {
				const { columns, layoutRows, shown, side, rows, placements } = rowsOf(w, h, n)
				let best = 0
				for (let c = 1; c <= n; c++) {
					best = Math.max(best, Math.floor(Math.min((w - 8 * (c - 1)) / c, (h - 8 * (Math.ceil(n / c) - 1)) / Math.ceil(n / c))))
				}
				if (best >= 150) {
					// все плитки на одной странице, сторона максимальна
					expect(side).toBe(best)
					expect(shown).toBe(n)
				} else {
					// ниже minSide включается листание: страница заполнена не больше, чем вмещает
					expect(shown).toBeLessThanOrEqual(columns * layoutRows)
				}
				// сетка помещается в область
				expect(side * columns + 8 * (columns - 1)).toBeLessThanOrEqual(w)
				expect(side * layoutRows + 8 * (layoutRows - 1)).toBeLessThanOrEqual(h)
				expect(placements.length).toBe(shown)
				expect(rows.reduce((a, b) => a + b, 0)).toBe(shown)
				expect(rows.length).toBeLessThanOrEqual(layoutRows)
				expect(rows.slice(0, -1).every((r) => r === columns)).toBe(true)
			}
		})

		test('390x700, 9 tiles: 4 rows of the page, the rest is paged', () => {
			const { columns, layoutRows, shown } = rowsOf(390, 700, 9)
			expect([columns, layoutRows, shown]).toEqual([2, 4, 8])
		})

		test('5 tiles: 3 on top, 2 below', () => {
			expect(rowsOf(1512, 800, 5).rows).toEqual([3, 2])
			expect(rowsOf(1180, 820, 5).rows).toEqual([3, 2])
		})

		test('7 tiles are 4+3 and 8 tiles are 4+4 in a wide window', () => {
			expect(rowsOf(1512, 800, 7).rows).toEqual([4, 3])
			expect(rowsOf(1512, 800, 8).rows).toEqual([4, 4])
		})
	})

	describe('phone held sideways (NAS_CLOUD#159)', () => {
		// 586x266 - область iPhone 17 Pro лёжа: окно 874 минус колонка названия и кнопки справа
		const area = { gridWidth: 586, gridHeight: 266 }

		test.each([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])('%i tiles with the local one: all on the page, one row or two, never paged', (total) => {
			const { columns, rows, side } = computeSquareLayout({ ...area, total, minSide: PHONE_LANDSCAPE_MIN_SIDE })
			expect(columns * rows).toBeGreaterThanOrEqual(total)
			expect(side).toBeGreaterThanOrEqual(PHONE_LANDSCAPE_MIN_SIDE)
			expect(side * columns + 8 * (columns - 1)).toBeLessThanOrEqual(area.gridWidth)
			expect(side * rows + 8 * (rows - 1)).toBeLessThanOrEqual(area.gridHeight)
		})

		test('side is the best one: 6 tiles are 3x2 at 129 px, 4 tiles 4x1 at 140 px, not two 216 px tiles with an arrow', () => {
			expect(computeSquareLayout({ ...area, total: 6, minSide: PHONE_LANDSCAPE_MIN_SIDE })).toEqual({ columns: 3, rows: 2, side: 129 })
			expect(computeSquareLayout({ ...area, total: 4, minSide: PHONE_LANDSCAPE_MIN_SIDE })).toEqual({ columns: 4, rows: 1, side: 140 })
			// прежнее правило (minSide 150) не вмещало шесть: листание
			const old = computeSquareLayout({ ...area, total: 6 })
			expect(old.columns * old.rows).toBeLessThan(6)
		})
	})

	describe('getJustifyContent', () => {
		test('centers the tiles of the grid', () => {
			expect(getJustifyContent({ isStripe: false, totalTiles: 1, isLocalVideoAlone: true })).toBe('center')
			expect(getJustifyContent({ isStripe: false, totalTiles: 5, isLocalVideoAlone: false })).toBe('center')
		})

		test('centers the tiles of a stripe holding several of them', () => {
			expect(getJustifyContent({ isStripe: true, totalTiles: 2, isLocalVideoAlone: false })).toBe('center')
		})

		test('keeps a lone local video at the end of the stripe', () => {
			expect(getJustifyContent({ isStripe: true, totalTiles: 1, isLocalVideoAlone: true })).toBe('end')
		})

		test('keeps a lone remote tile at the start of the stripe', () => {
			// The local video is not shown as a tile, so the only tile left is a
			// remote one and it belongs to the start of the row
			expect(getJustifyContent({ isStripe: true, totalTiles: 1, isLocalVideoAlone: false })).toBe('start')
		})
	})
})

// ket4tec (NAS_CLOUD#159): крупная плитка «Говорящего крупно» - прямоугольник области над рядом маленьких (k7call.scss)
describe('big tile of the speaker view', () => {
	const scss = readFileSync(resolve(__dirname, '../k7call.scss'), 'utf8')

	test('the big camera tile fills the promoted area, it is not a square', () => {
		const rule = scss.split('\n').find((line) => line.startsWith('#call-container .video__promoted > .video-container-big {'))
		expect(rule).toContain('width: 100cqw')
		expect(rule).toContain('height: 100cqh')
		expect(rule).not.toContain('cqmin')
	})

	test.each([
		[440, 460, STRIPE_HEIGHT - 24], // телефон: ряд 110 + поля, см. k7call.scss
		[1000, 750, STRIPE_HEIGHT],
		[1440, 800, STRIPE_HEIGHT],
	])('area %ix%i: at least 70 percent is the big tile', (width, height, row) => {
		const share = ((height - row - GRID_GAP) * width) / (width * height)
		expect(share).toBeGreaterThanOrEqual(0.7)
	})
})

// ket4tec (NAS_CLOUD#159): плашка шапки телефона лёжа (874x402, сетка 766x378) - сдвиг сетки только там, где она легла бы на плитку
describe('phoneBarOverlaps', () => {
	test.each([[2, true], [3, false], [4, false], [5, true], [6, true], [9, false]])('N=%i -> %s', (total, expected) => {
		const layout = k4Square({ gridWidth: 766, gridHeight: 378, total, minSide: 60 })
		expect(phoneBarOverlaps({ gridWidth: 766, gridHeight: 378, total, layout })).toBe(expected)
	})
})
