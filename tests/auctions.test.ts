import { Contract, JWKInterface, PstState } from 'warp-contracts';

import {
  ARNS_NAME_RESERVED_MESSAGE,
  AUCTION_SETTINGS,
  INVALID_INPUT_MESSAGE,
  MINIMUM_ALLOWED_NAME_LENGTH,
  NON_EXPIRED_ARNS_NAME_MESSAGE,
  SHORT_NAME_RESERVATION_UNLOCK_TIMESTAMP,
} from '../src/constants';
import { Auction, AuctionSettings, IOState } from '../src/types';
import { arweave, warp } from './setup.jest';
import { ANT_CONTRACT_IDS } from './utils/constants';
import {
  calculateMinimumAuctionBid,
  getCurrentBlock,
  getLocalArNSContractId,
  getLocalWallet,
  mineBlocks,
} from './utils/helper';

describe('Auctions', () => {
  let contract: Contract<PstState>;
  let srcContractId: string;

  beforeAll(async () => {
    srcContractId = getLocalArNSContractId();
  });

  describe('any address', () => {
    let nonContractOwner: JWKInterface;
    let nonContractOwnerAddress: string;
    let contractOwnerAddress: string;
    let contractOwner;

    beforeAll(async () => {
      nonContractOwner = getLocalWallet(1);
      contractOwner = getLocalWallet(0);
      contract = warp.pst(srcContractId).connect(nonContractOwner);
      nonContractOwnerAddress = await arweave.wallets.getAddress(
        nonContractOwner,
      );
      contractOwnerAddress = await arweave.wallets.getAddress(contractOwner);
    });

    describe('submits an auction bid', () => {
      describe('with bad input', () => {
        it.each([
          '',
          '*&*##$%#',
          '-leading',
          'this-is-a-looong-name-a-verrrryyyyy-loooooong-name-that-is-too-long',
          'test.subdomain.name',
          false,
          true,
          0,
          1,
          3.5,
        ])(
          'should throw an error when an invalid name is submitted: %s',
          async (badName) => {
            const auctionBid = {
              name: badName,
              contractTxId: ANT_CONTRACT_IDS[0],
              type: 'lease',
            };
            const writeInteraction = await contract.writeInteraction(
              {
                function: 'submitAuctionBid',
                ...auctionBid,
              },
              {
                disableBundling: true,
              },
            );

            expect(writeInteraction?.originalTxId).not.toBe(undefined);
            const { cachedValue } = await contract.readState();
            expect(Object.keys(cachedValue.errorMessages)).toContain(
              writeInteraction!.originalTxId,
            );
            expect(
              cachedValue.errorMessages[writeInteraction!.originalTxId],
            ).toEqual(expect.stringContaining(INVALID_INPUT_MESSAGE));
            // TODO: check balances
          },
        );

        it.each([
          '',
          '*&*##$%#',
          '-leading',
          'this-is-a-looong-name-a-verrrryyyyy-loooooong-name-that-is-too-long',
          'test.subdomain.name',
          false,
          true,
          0,
          1,
          3.5,
        ])(
          'should throw an error when an invalid type is submitted: %s',
          async (badType) => {
            const auctionBid = {
              name: 'apple',
              contractTxId: ANT_CONTRACT_IDS[0],
              type: badType,
            };
            const writeInteraction = await contract.writeInteraction(
              {
                function: 'submitAuctionBid',
                ...auctionBid,
              },
              {
                disableBundling: true,
              },
            );

            expect(writeInteraction?.originalTxId).not.toBe(undefined);
            const { cachedValue } = await contract.readState();
            expect(Object.keys(cachedValue.errorMessages)).toContain(
              writeInteraction!.originalTxId,
            );
            expect(
              cachedValue.errorMessages[writeInteraction!.originalTxId],
            ).toEqual(expect.stringContaining(INVALID_INPUT_MESSAGE));
            // TODO: check balances
          },
        );

        it.each([
          '',
          '*&*##$%#',
          '-leading',
          'this-is-a-looong-name-a-verrrryyyyy-loooooong-name-that-is-too-long',
          'test.subdomain.name',
          false,
          true,
          0,
          1,
          3.5,
        ])(
          'should throw an error when an invalid contract TX id is provided: %s',
          async (badTxId) => {
            const auctionBid = {
              name: 'apple',
              contractTxId: badTxId,
              type: 'lease',
            };
            const writeInteraction = await contract.writeInteraction(
              {
                function: 'submitAuctionBid',
                ...auctionBid,
              },
              {
                disableBundling: true,
              },
            );

            expect(writeInteraction?.originalTxId).not.toBe(undefined);
            const { cachedValue } = await contract.readState();
            expect(Object.keys(cachedValue.errorMessages)).toContain(
              writeInteraction!.originalTxId,
            );
            expect(
              cachedValue.errorMessages[writeInteraction!.originalTxId],
            ).toEqual(expect.stringContaining(INVALID_INPUT_MESSAGE));
            //  TODO: check balances
          },
        );
      });

      describe('with valid input', () => {
        describe('for a lease', () => {
          describe('for a non-existent auction', () => {
            let auctionTxId: string;
            let auctionObj: Auction;
            let prevState: IOState;
            const auctionBid = {
              name: 'apple',
              contractTxId: ANT_CONTRACT_IDS[0],
            };

            beforeEach(async () => {
              prevState = (await contract.readState()).cachedValue
                .state as IOState;
              contract.connect(nonContractOwner);
            });

            it('should create the initial auction object', async () => {
              const writeInteraction = await contract.writeInteraction({
                function: 'submitAuctionBid',
                ...auctionBid,
              });
              expect(writeInteraction?.originalTxId).not.toBe(undefined);
              const { cachedValue } = await contract.readState();
              const { auctions, balances } = cachedValue.state as IOState;
              expect(auctions[auctionBid.name]).not.toBe(undefined);
              expect(auctions[auctionBid.name]).toEqual(
                expect.objectContaining({
                  floorPrice: expect.any(Number),
                  startPrice: expect.any(Number),
                  type: 'lease',
                  auctionSettingsId: AUCTION_SETTINGS.current,
                  startHeight: await getCurrentBlock(arweave),
                  initiator: nonContractOwnerAddress,
                  contractTxId: ANT_CONTRACT_IDS[0],
                  years: 1,
                }),
              );
              expect(balances[nonContractOwnerAddress]).toEqual(
                prevState.balances[nonContractOwnerAddress] -
                  auctions[auctionBid.name].floorPrice,
              );
              // for the remaining tests
              auctionObj = auctions[auctionBid.name];
              auctionTxId = writeInteraction!.originalTxId;
            });

            describe('another bid', () => {
              it('should throw an error when the bid does not meet the minimum required', async () => {
                const auctionBid = {
                  name: 'apple',
                  qty: 100, // not going to win it
                  contractTxId: ANT_CONTRACT_IDS[0],
                };
                // connect using another wallet
                const separateWallet = await getLocalWallet(2);
                await contract.connect(separateWallet);
                const writeInteraction = await contract.writeInteraction({
                  function: 'submitAuctionBid',
                  ...auctionBid,
                });
                expect(writeInteraction?.originalTxId).not.toBeUndefined();
                const { cachedValue } = await contract.readState();
                expect(Object.keys(cachedValue.errorMessages)).toContain(
                  writeInteraction!.originalTxId,
                );
                expect(
                  cachedValue.errorMessages[writeInteraction!.originalTxId],
                ).toEqual(
                  expect.stringContaining(
                    `The bid (${100} IO) is less than the current required minimum bid`,
                  ),
                );
                const { auctions, records, balances } =
                  cachedValue.state as IOState;
                expect(auctions[auctionBid.name]).toEqual(auctionObj);
                expect(records[auctionBid.name]).toBeUndefined();
                expect(balances).toEqual(prevState.balances);
              });

              it('should update the records object when a winning bid comes in', async () => {
                // fast forward a few blocks, then construct winning bid
                const auctionSettings: AuctionSettings =
                  AUCTION_SETTINGS.history[0];
                await mineBlocks(arweave, 3504);
                const winningBidQty = calculateMinimumAuctionBid({
                  startHeight: auctionObj.startHeight,
                  startPrice: auctionObj.startPrice,
                  floorPrice: auctionObj.floorPrice,
                  currentBlockHeight: await getCurrentBlock(arweave),
                  decayInterval: auctionSettings.decayInterval,
                  decayRate: auctionSettings.decayRate,
                });
                const auctionBid = {
                  name: 'apple',
                  qty: winningBidQty,
                  contractTxId: ANT_CONTRACT_IDS[1],
                };
                // connect using another wallet
                const separateWallet = await getLocalWallet(2);
                await contract.connect(separateWallet);
                const winnerAddress = await arweave.wallets.getAddress(
                  separateWallet,
                );
                const writeInteraction = await contract.writeInteraction({
                  function: 'submitAuctionBid',
                  ...auctionBid,
                });
                expect(writeInteraction?.originalTxId).not.toBeUndefined();
                const { cachedValue } = await contract.readState();
                expect(cachedValue.errorMessages).not.toContain(auctionTxId);
                const { auctions, records, balances } =
                  cachedValue.state as IOState;
                expect(auctions[auctionBid.name]).toBeUndefined();
                expect(records[auctionBid.name]).toEqual({
                  contractTxId: ANT_CONTRACT_IDS[1],
                  endTimestamp: expect.any(Number),
                  startTimestamp: expect.any(Number),
                  undernames: expect.any(Number),
                  type: 'lease',
                });
                expect(balances[winnerAddress]).toEqual(
                  prevState.balances[winnerAddress] - winningBidQty,
                );
                expect(balances[contractOwnerAddress]).toEqual(
                  prevState.balances[contractOwnerAddress] + winningBidQty,
                );
                expect(balances[auctionObj.initiator]).toEqual(
                  prevState.balances[auctionObj.initiator] +
                    auctionObj.floorPrice,
                );
                // clear out the auction obj
                auctionObj = auctions[auctionBid.name];
              });
            });

            it('should throw an error if the name already exist in records', async () => {
              const auctionBid = {
                name: 'apple',
                contractTxId: ANT_CONTRACT_IDS[0],
              };
              // connect using another wallet
              const separateWallet = await getLocalWallet(2);
              await contract.connect(separateWallet);
              const writeInteraction = await contract.writeInteraction({
                function: 'submitAuctionBid',
                ...auctionBid,
              });
              expect(writeInteraction?.originalTxId).not.toBe(undefined);
              const { cachedValue } = await contract.readState();
              const { auctions, balances } = cachedValue.state as IOState;
              expect(Object.keys(cachedValue.errorMessages)).toContain(
                writeInteraction!.originalTxId,
              );
              expect(
                cachedValue.errorMessages[writeInteraction!.originalTxId],
              ).toEqual(NON_EXPIRED_ARNS_NAME_MESSAGE);
              expect(auctions[auctionBid.name]).toBeUndefined();
              expect(balances).toEqual(prevState.balances);
            });

            it('should throw an error if a name is reserved that has no expiration', async () => {
              const auctionBid = {
                name: 'www',
                contractTxId: ANT_CONTRACT_IDS[0],
              };
              const writeInteraction = await contract.writeInteraction({
                function: 'submitAuctionBid',
                ...auctionBid,
              });
              expect(writeInteraction?.originalTxId).not.toBe(undefined);
              const { cachedValue } = await contract.readState();
              const { auctions, balances } = cachedValue.state as IOState;
              expect(Object.keys(cachedValue.errorMessages)).toContain(
                writeInteraction!.originalTxId,
              );
              expect(
                cachedValue.errorMessages[writeInteraction!.originalTxId],
              ).toEqual(ARNS_NAME_RESERVED_MESSAGE);
              expect(auctions[auctionBid.name]).toBeUndefined();
              expect(balances).toEqual(prevState.balances);
            });

            it('should throw an error if less than the short name minimum length and short name expiration has not passed', async () => {
              const auctionBid = {
                name: 'ibm',
                contractTxId: ANT_CONTRACT_IDS[0],
              };
              const writeInteraction = await contract.writeInteraction({
                function: 'submitAuctionBid',
                ...auctionBid,
              });
              expect(writeInteraction?.originalTxId).not.toBe(undefined);
              const { cachedValue } = await contract.readState();
              const { auctions, balances } = cachedValue.state as IOState;
              expect(Object.keys(cachedValue.errorMessages)).toContain(
                writeInteraction!.originalTxId,
              );
              expect(
                cachedValue.errorMessages[writeInteraction!.originalTxId],
              ).toEqual(
                `Name is less than ${MINIMUM_ALLOWED_NAME_LENGTH} characters. It will be available for auction after ${SHORT_NAME_RESERVATION_UNLOCK_TIMESTAMP}.`,
              );
              expect(auctions[auctionBid.name]).toBeUndefined();
              expect(balances).toEqual(prevState.balances);
            });

            it('should throw an error if a name is reserved for a specific wallet without an expiration', async () => {
              const auctionBid = {
                name: 'twitter',
                contractTxId: ANT_CONTRACT_IDS[0],
              };
              // connect using another wallet
              const separateWallet = await getLocalWallet(2);
              await contract.connect(separateWallet);
              const writeInteraction = await contract.writeInteraction({
                function: 'submitAuctionBid',
                ...auctionBid,
              });
              expect(writeInteraction?.originalTxId).not.toBe(undefined);
              const { cachedValue } = await contract.readState();
              const { auctions, balances } = cachedValue.state as IOState;
              expect(Object.keys(cachedValue.errorMessages)).toContain(
                writeInteraction!.originalTxId,
              );
              expect(
                cachedValue.errorMessages[writeInteraction!.originalTxId],
              ).toEqual(ARNS_NAME_RESERVED_MESSAGE);
              expect(auctions[auctionBid.name]).toBeUndefined();
              expect(balances).toEqual(prevState.balances);
            });

            it('should start the auction if the reserved target submits the auction bid', async () => {
              const auctionBid = {
                name: 'twitter',
                contractTxId: ANT_CONTRACT_IDS[0],
              };
              const writeInteraction = await contract.writeInteraction({
                function: 'submitAuctionBid',
                ...auctionBid,
              });
              expect(writeInteraction?.originalTxId).not.toBe(undefined);
              const { cachedValue } = await contract.readState();
              const { auctions, balances, reserved } =
                cachedValue.state as IOState;
              expect(Object.keys(cachedValue.errorMessages)).not.toContain(
                writeInteraction!.originalTxId,
              );
              expect(auctions[auctionBid.name]).toEqual({
                floorPrice: expect.any(Number),
                startPrice: expect.any(Number),
                type: 'lease',
                auctionSettingsId: AUCTION_SETTINGS.current,
                startHeight: await getCurrentBlock(arweave),
                initiator: nonContractOwnerAddress,
                contractTxId: ANT_CONTRACT_IDS[0],
                years: 1,
              });
              expect(balances[nonContractOwnerAddress]).toEqual(
                prevState.balances[nonContractOwnerAddress] -
                  auctions[auctionBid.name].floorPrice,
              );
              expect(reserved[auctionBid.name]).toBeUndefined();
            });
          });
        });
      });

      describe('for a permabuy', () => {
        let auctionTxId: string;
        let auctionObj: Auction;
        let prevState: IOState;
        const auctionBid = {
          name: 'microsoft',
          contractTxId: ANT_CONTRACT_IDS[0],
          type: 'permabuy',
        };

        beforeEach(async () => {
          prevState = (await contract.readState()).cachedValue.state as IOState;
          contract.connect(nonContractOwner);
        });

        it('should create the initial auction object', async () => {
          const writeInteraction = await contract.writeInteraction({
            function: 'submitAuctionBid',
            ...auctionBid,
          });
          expect(writeInteraction?.originalTxId).not.toBe(undefined);
          const { cachedValue } = await contract.readState();
          const { auctions, balances } = cachedValue.state as IOState;
          expect(auctions[auctionBid.name]).not.toBe(undefined);
          expect(auctions[auctionBid.name]).toEqual({
            floorPrice: expect.any(Number),
            startPrice: expect.any(Number),
            type: 'permabuy',
            auctionSettingsId: AUCTION_SETTINGS.current,
            startHeight: await getCurrentBlock(arweave),
            initiator: nonContractOwnerAddress,
            contractTxId: ANT_CONTRACT_IDS[0],
          });
          expect(balances[nonContractOwnerAddress]).toEqual(
            prevState.balances[nonContractOwnerAddress] -
              auctions[auctionBid.name].floorPrice,
          );
          // for the remaining tests
          auctionObj = auctions[auctionBid.name];
          auctionTxId = writeInteraction!.originalTxId;
        });

        it('should update the records object when a winning bid comes in', async () => {
          // fast forward a few blocks, then construct winning bid
          const auctionSettings: AuctionSettings = AUCTION_SETTINGS.history[0];
          await mineBlocks(arweave, 3504);
          const winningBidQty = calculateMinimumAuctionBid({
            startHeight: auctionObj.startHeight,
            startPrice: auctionObj.startPrice,
            floorPrice: auctionObj.floorPrice,
            currentBlockHeight: await getCurrentBlock(arweave),
            decayInterval: auctionSettings.decayInterval,
            decayRate: auctionSettings.decayRate,
          });
          const auctionBid = {
            name: 'microsoft',
            qty: winningBidQty,
            contractTxId: ANT_CONTRACT_IDS[1],
          };
          // connect using another wallet
          const separateWallet = await getLocalWallet(2);
          await contract.connect(separateWallet);
          const winnerAddress = await arweave.wallets.getAddress(
            separateWallet,
          );
          const writeInteraction = await contract.writeInteraction({
            function: 'submitAuctionBid',
            ...auctionBid,
          });
          expect(writeInteraction?.originalTxId).not.toBeUndefined();
          const { cachedValue } = await contract.readState();
          expect(cachedValue.errorMessages).not.toContain(auctionTxId);
          const { auctions, records, balances } = cachedValue.state as IOState;
          expect(records[auctionBid.name]).toEqual({
            contractTxId: ANT_CONTRACT_IDS[1],
            type: 'permabuy',
            startTimestamp: expect.any(Number),
            undernames: expect.any(Number),
          });
          expect(auctions[auctionBid.name]).toBeUndefined();
          expect(balances[winnerAddress]).toEqual(
            prevState.balances[winnerAddress] - winningBidQty,
          );
          expect(balances[auctionObj.initiator]).toEqual(
            prevState.balances[auctionObj.initiator] + auctionObj.floorPrice,
          );
          expect(balances[contractOwnerAddress]).toEqual(
            prevState.balances[contractOwnerAddress] + winningBidQty,
          );
        });
      });

      describe('for an eager initiator', () => {
        let auctionTxId: string;
        let auctionObj: Auction;
        let prevState: IOState;
        const auctionBid = {
          name: 'tesla',
          contractTxId: ANT_CONTRACT_IDS[0],
        };

        beforeEach(async () => {
          prevState = (await contract.readState()).cachedValue.state as IOState;
          contract.connect(nonContractOwner);
        });

        it('should create the initial auction object', async () => {
          const writeInteraction = await contract.writeInteraction({
            function: 'submitAuctionBid',
            ...auctionBid,
          });
          expect(writeInteraction?.originalTxId).not.toBe(undefined);
          const { cachedValue } = await contract.readState();
          const { auctions, balances } = cachedValue.state as IOState;
          expect(auctions[auctionBid.name]).not.toBe(undefined);
          expect(auctions[auctionBid.name]).toEqual({
            floorPrice: expect.any(Number),
            startPrice: expect.any(Number),
            type: 'lease',
            auctionSettingsId: AUCTION_SETTINGS.current,
            startHeight: await getCurrentBlock(arweave),
            initiator: nonContractOwnerAddress,
            contractTxId: ANT_CONTRACT_IDS[0],
            years: 1,
          });
          expect(balances[nonContractOwnerAddress]).toEqual(
            prevState.balances[nonContractOwnerAddress] -
              auctions[auctionBid.name].floorPrice,
          );
          // for the remaining tests
          auctionObj = auctions[auctionBid.name];
          auctionTxId = writeInteraction!.originalTxId;
        });

        it.each([-10, -1, 10, 19, 20, 69])(
          `should expect the bid amount to not exceed the start price after %s blocks`,
          async (block) => {
            // fast forward a few blocks, then construct winning bid
            const auctionSettings: AuctionSettings =
              AUCTION_SETTINGS.history[0];

            const winningBidQty = calculateMinimumAuctionBid({
              startHeight: auctionObj.startHeight,
              startPrice: auctionObj.startPrice,
              floorPrice: auctionObj.floorPrice,
              currentBlockHeight: auctionObj.startHeight + block,
              decayInterval: auctionSettings.decayInterval,
              decayRate: auctionSettings.decayRate,
            });

            expect(winningBidQty).toBeLessThanOrEqual(auctionObj.startPrice);
          },
        );

        it('should update the records when the caller is the initiator, and only withdraw the difference of the current bid to the original floor price that was already withdrawn from the initiator', async () => {
          // fast forward a few blocks, then construct winning bid
          const auctionSettings: AuctionSettings = AUCTION_SETTINGS.history[0];
          await mineBlocks(arweave, 3504);
          const winningBidQty = calculateMinimumAuctionBid({
            startHeight: auctionObj.startHeight,
            startPrice: auctionObj.startPrice,
            floorPrice: auctionObj.floorPrice,
            currentBlockHeight: await getCurrentBlock(arweave),
            decayInterval: auctionSettings.decayInterval,
            decayRate: auctionSettings.decayRate,
          });
          const auctionBid = {
            name: 'tesla',
            qty: winningBidQty,
            contractTxId: ANT_CONTRACT_IDS[1],
          };
          const writeInteraction = await contract.writeInteraction({
            function: 'submitAuctionBid',
            ...auctionBid,
          });
          expect(writeInteraction?.originalTxId).not.toBeUndefined();
          const { cachedValue } = await contract.readState();
          expect(cachedValue.errorMessages).not.toContain(auctionTxId);
          const { auctions, records, balances } = cachedValue.state as IOState;
          expect(auctions[auctionBid.name]).toBeUndefined();
          expect(records[auctionBid.name]).toEqual({
            contractTxId: ANT_CONTRACT_IDS[1],
            type: 'lease',
            endTimestamp: expect.any(Number),
            startTimestamp: expect.any(Number),
            undernames: expect.any(Number),
          });
          const floorToBidDifference = winningBidQty - auctionObj.floorPrice;
          expect(balances[nonContractOwnerAddress]).toEqual(
            prevState.balances[nonContractOwnerAddress] - floorToBidDifference,
          );
          expect(balances[contractOwnerAddress]).toEqual(
            prevState.balances[contractOwnerAddress] + winningBidQty,
          );
        });
      });
    });
  });
});
