import { Interface } from "@ethersproject/abi";
import { EventData } from "@/events-sync/data";

export const match: EventData = {
  kind: "rarible-match",
  addresses: { ["0x9757F2d2b135150BBeb65308D4a91804107cd8D6".toLowerCase()]: true },
  topic: "0x268820db288a211986b26a8fda86b1e0046281b21206936bb0e61c67b5c79ef4",
  numTopics: 1,
  abi: new Interface([
    `event Match(
      bytes32 leftHash,
      bytes32 rightHash,
      address leftMaker,
      address rightMaker,
      uint newLeftFill,
      uint newRightFill,
      (bytes4 assetClass, bytes data) leftAsset,
      (bytes4 assetClass, bytes data) rightAsset
    )`,
  ]),
};
