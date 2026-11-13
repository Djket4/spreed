<?php

declare(strict_types=1);
/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\php\Controller;

use OCA\Talk\Authenticator;
use OCA\Talk\BackgroundJob\EndEmptyCall;
use OCA\Talk\Config;
use OCA\Talk\Controller\CallController;
use OCA\Talk\Manager;
use OCA\Talk\Model\PhoneNumberMapper;
use OCA\Talk\Room;
use OCA\Talk\Service\ConsentService;
use OCA\Talk\Service\ParticipantService;
use OCA\Talk\Service\RoomService;
use OCA\Talk\Service\SIPDialOutService;
use OCP\AppFramework\Services\IAppConfig;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserManager;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

/**
 * NAS_CLOUD#129: возврат в звонок до и после отсрочки (endEmptyCallBeforeJoin).
 */
class CallControllerEmptyCallTest extends TestCase {
	private IAppConfig&MockObject $appConfig;
	private RoomService&MockObject $roomService;
	private ParticipantService&MockObject $participantService;
	private CallController $controller;

	protected function setUp(): void {
		parent::setUp();
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->roomService = $this->createMock(RoomService::class);
		$this->participantService = $this->createMock(ParticipantService::class);
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1000);
		$this->controller = new CallController(
			'spreed',
			$this->createMock(IRequest::class),
			$this->createMock(Manager::class),
			$this->createMock(ConsentService::class),
			$this->participantService,
			$this->createMock(PhoneNumberMapper::class),
			$this->roomService,
			$this->createMock(IUserManager::class),
			$time,
			$this->createMock(IConfig::class),
			$this->appConfig,
			$this->createMock(Config::class),
			$this->createMock(Authenticator::class),
			$this->createMock(SIPDialOutService::class),
		);
		$room = $this->createMock(Room::class);
		$room->method('getId')->willReturn(42);
		$this->controller->setRoom($room);
	}

	public function testReturnBeforeGraceKeepsCall(): void {
		$this->appConfig->method('getAppValueInt')->willReturn(1000 - EndEmptyCall::GRACE + 10);
		$this->roomService->expects($this->never())->method('resetActiveSince');
		self::invokePrivate($this->controller, 'endEmptyCallBeforeJoin');
	}

	public function testReturnAfterGraceEndsOldCallAtEmptyMoment(): void {
		$emptySince = 1000 - EndEmptyCall::GRACE - 5;
		$this->appConfig->method('getAppValueInt')->willReturn($emptySince);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(false);
		$this->roomService->expects($this->once())->method('resetActiveSince')->with($this->anything(), null, $emptySince);
		self::invokePrivate($this->controller, 'endEmptyCallBeforeJoin');
	}

	public function testNoMarkNoAction(): void {
		$this->appConfig->method('getAppValueInt')->willReturn(0);
		$this->roomService->expects($this->never())->method('resetActiveSince');
		self::invokePrivate($this->controller, 'endEmptyCallBeforeJoin');
	}
}
