import { ethers } from 'ethers';

/**
 *  The next four functions seem to be in a state of transition - so to keep things reliable they've been included here
 *  ala static binary-like.
 * @param sponsorAddress
 */
export const deriveWalletPathFromSponsorAddress = (sponsorAddress: string): string => {
  const sponsorAddressBN = ethers.BigNumber.from(ethers.utils.getAddress(sponsorAddress));
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `1/${paths.join('/')}`;
};

export const verifyAirnodeXpub = (airnodeXpub: string, airnodeAddress: string): ethers.utils.HDNode => {
  // The xpub is expected to belong to the hardened path m/44'/60'/0'
  // so we must derive the child default derivation path m/44'/60'/0'/0/0
  // to compare it and check if xpub belongs to the Airnode wallet
  const hdNode = ethers.utils.HDNode.fromExtendedKey(airnodeXpub);
  if (airnodeAddress !== hdNode.derivePath('0/0').address) {
    throw new Error(`xpub does not belong to Airnode: ${airnodeAddress}`);
  }
  return hdNode;
};

export const deriveAirnodeXpub = (airnodeMnemonic: string): string => {
  const airnodeHdNode = ethers.utils.HDNode.fromMnemonic(airnodeMnemonic).derivePath("m/44'/60'/0'");
  return airnodeHdNode.neuter().extendedKey;
};

export const deriveSponsorWalletAddress = async (
  airnodeXpub: string,
  airnodeAddress: string,
  sponsorAddress: string
) => {
  const hdNode = verifyAirnodeXpub(airnodeXpub, airnodeAddress);
  const derivationPath = deriveWalletPathFromSponsorAddress(sponsorAddress);
  return hdNode.derivePath(derivationPath).address;
};
