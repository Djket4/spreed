/**
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'vitest'
import {
	computeRowDistribution,
	computeSquareLayout,
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
			// 7 tiles over 2 rows of a 4 columns grid: 3 and 4 tiles
			expect(computeTilePlacements({ ...grid, rows: 2, totalTiles: 7 })).toEqual([
				{ row: 1, column: 2 },
				{ row: 1, column: 4 },
				{ row: 1, column: 6 },
				{ row: 2, column: 1 },
				{ row: 2, column: 3 },
				{ row: 2, column: 5 },
				{ row: 2, column: 7 },
			])
		})

		test('centers a row leaving an even number of columns empty', () => {
			// 7 tiles over 3 rows of a 4 columns grid: 2, 3 and 2 tiles
			expect(computeTilePlacements({ ...grid, rows: 3, totalTiles: 7 })).toEqual([
				{ row: 1, column: 3 },
				{ row: 1, column: 5 },
				{ row: 2, column: 2 },
				{ row: 2, column: 4 },
				{ row: 2, column: 6 },
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

						const distribution = computeRowDistribution({ totalTiles, rows })
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
