import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { zeroAddress } from "viem";

async function setup() {
  const connection = await network.create();
  const { viem } = connection;

  const [
    owner,
    pendingOwner,
    outsider,
  ] = await viem.getWalletClients();

  const publicClient =
    await viem.getPublicClient();

  const traceForge =
    await viem.deployContract("TraceForge");

  async function wait(hash: `0x${string}`) {
    return publicClient.waitForTransactionReceipt({
      hash,
    });
  }

  async function asWallet(
    wallet: typeof owner,
  ) {
    return viem.getContractAt(
      "TraceForge",
      traceForge.address,
      {
        client: {
          wallet,
        },
      },
    );
  }

  return {
    owner,
    pendingOwner,
    outsider,
    traceForge,
    wait,
    asWallet,
  };
}

describe("TraceForge platform ownership", () => {
  it("assigns initial ownership to the deployer", async () => {
    const {
      owner,
      traceForge,
    } = await setup();

    assert.equal(
      (await traceForge.read.owner()).toLowerCase(),
      owner.account.address.toLowerCase(),
    );

    assert.equal(
      await traceForge.read.pendingOwner(),
      zeroAddress,
    );
  });

  it("starts ownership transfer without immediately changing owner", async () => {
    const {
      owner,
      pendingOwner,
      traceForge,
      wait,
    } = await setup();

    await wait(
      await traceForge.write.transferOwnership([
        pendingOwner.account.address,
      ]),
    );

    assert.equal(
      (await traceForge.read.owner()).toLowerCase(),
      owner.account.address.toLowerCase(),
    );

    assert.equal(
      (await traceForge.read.pendingOwner()).toLowerCase(),
      pendingOwner.account.address.toLowerCase(),
    );
  });

  it("rejects ownership acceptance by anyone except the pending owner", async () => {
    const {
      pendingOwner,
      outsider,
      traceForge,
      wait,
      asWallet,
    } = await setup();

    await wait(
      await traceForge.write.transferOwnership([
        pendingOwner.account.address,
      ]),
    );

    const outsiderContract =
      await asWallet(outsider);

    await assert.rejects(async () => {
      await outsiderContract.write.acceptOwnership();
    });
  });

  it("allows the pending owner to accept ownership", async () => {
    const {
      pendingOwner,
      traceForge,
      wait,
      asWallet,
    } = await setup();

    await wait(
      await traceForge.write.transferOwnership([
        pendingOwner.account.address,
      ]),
    );

    const pendingOwnerContract =
      await asWallet(pendingOwner);

    await wait(
      await pendingOwnerContract.write.acceptOwnership(),
    );

    assert.equal(
      (await traceForge.read.owner()).toLowerCase(),
      pendingOwner.account.address.toLowerCase(),
    );

    assert.equal(
      await traceForge.read.pendingOwner(),
      zeroAddress,
    );
  });

  it("does not allow platform ownership to be renounced", async () => {
    const {
      owner,
      traceForge,
    } = await setup();

    await assert.rejects(async () => {
      await traceForge.write.renounceOwnership();
    });

    assert.equal(
      (await traceForge.read.owner()).toLowerCase(),
      owner.account.address.toLowerCase(),
    );
  });
});
