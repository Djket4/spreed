<?php

declare(strict_types=1);
/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\php\Controller;

use OCA\Talk\Authenticator;
use OCA\Talk\Config;
use OCA\Talk\Controller\CallController;
use OCA\Talk\Manager;
use OCA\Talk\Model\PhoneNumberMapper;
use OCA\Talk\Participant;
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
 * NAS_CLOUD#201: федеративный выход из звонка идёт через отсрочку, вход (в том числе федеративный)
 * сначала закрывает просроченный пустой звонок.
 */
class CallControllerEmptyCallTest extends TestCase {
	private RoomService&MockObject $roomService;
	private ParticipantService&MockObject $participantService;
	private CallController $controller;
	private Room&MockObject $room;

	protected function setUp(): void {
		parent::setUp();
		$this->roomService = $this->createMock(RoomService::class);
		$this->participantService = $this->createMock(ParticipantService::class);
		$auth = $this->createMock(Authenticator::class);
		$auth->method('isFederationRequest')->willReturn(true);
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
			$this->createMock(IAppConfig::class),
			$this->createMock(Config::class),
			$auth,
			$this->createMock(SIPDialOutService::class),
		);
		$this->room = $this->createMock(Room::class);
		$this->room->method('getId')->willReturn(42);
		$this->controller->setRoom($this->room);
		$this->controller->setParticipant($this->createMock(Participant::class));
	}

	public function testLeaveFederatedCallDefersEmptyCall(): void {
		$this->participantService->expects($this->once())->method('resetCallStateWhenNeeded')->with($this->room);
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->controller->leaveFederatedCall('sess');
	}

	public function testJoinFederatedCallEndsExpiredEmptyCallFirst(): void {
		$calls = [];
		$this->roomService->method('endEmptyCallBeforeJoin')->willReturnCallback(function () use (&$calls): void {
			$calls[] = 'end';
		});
		$this->participantService->method('changeInCall')->willReturnCallback(function () use (&$calls): void {
			$calls[] = 'join';
		});
		$this->controller->joinFederatedCall('sess', Participant::FLAG_IN_CALL);
		$this->assertSame(['end', 'join'], $calls);
	}
}
