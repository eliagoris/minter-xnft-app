import { useCallback, useEffect, useMemo, useState } from "react"
import * as anchor from "@project-serum/anchor"
import React from "react"

import { Commitment, Connection, PublicKey, Transaction } from "@solana/web3.js"

import {
  awaitTransactionSignatureConfirmation,
  CANDY_MACHINE_PROGRAM,
  CandyMachineAccount,
  createAccountsForMint,
  getCandyMachineState,
  getCollectionPDA,
  mintOneToken,
  SetupState,
} from "../../lib/candy-machine"
import {
  AlertState,
  formatNumber,
  getAtaForMint,
  toDate,
} from "../../lib/candy-machine/utils"
import { MintCountdown } from "./MintCountdown"
import { MintButton } from "./MintButton"
import { GatewayProvider } from "@civic/solana-gateway-react"
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base"
import { Button, Text, usePublicKey, View } from "react-xnft"

const connectButtonStyles = {
  width: "100%",
  height: "60px",
  marginTop: "10px",
  marginBottom: "5px",
  background: "linear-gradient(180deg, #604ae5 0%, #813eee 100%)",
  color: "white",
  fontSize: "16px",
  fontWeight: "bold",
}

export interface HomeProps {
  candyMachineId?: anchor.web3.PublicKey
}

const Minter = (props: HomeProps) => {
  const [isUserMinting, setIsUserMinting] = useState(false)
  const [candyMachine, setCandyMachine] = useState<CandyMachineAccount>()
  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: "",
    severity: undefined,
  })
  const [isActive, setIsActive] = useState(false)
  const [endDate, setEndDate] = useState<Date>()
  const [itemsRemaining, setItemsRemaining] = useState<number>()
  const [isWhitelistUser, setIsWhitelistUser] = useState(false)
  const [isPresale, setIsPresale] = useState(false)
  const [isValidBalance, setIsValidBalance] = useState(false)
  const [discountPrice, setDiscountPrice] = useState<anchor.BN>()
  const [needTxnSplit, setNeedTxnSplit] = useState(true)
  const [setupTxn, setSetupTxn] = useState<SetupState>()

  // @ts-ignore
  const connection = window.xnft.solana.connection
  const publicKey = usePublicKey()
  const wallet = {
    publicKey,
    // @ts-ignore
    signAllTransactions: window.xnft.signAllTransactions,
    // @ts-ignore
    signTransaction: window.xnft.signTransaction,
    connected: true,
  }

  const anchorWallet = useMemo(() => {
    if (publicKey || window.xnft.signTransaction) {
      return
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: window.xnft.signAllTransactions,
      signTransaction: window.xnft.signTransaction,
    } as anchor.Wallet
  }, [window.xnft.signAllTransactions, window.xnft.signTransaction, publicKey])

  const refreshCandyMachineState = useCallback(
    async (commitment: Commitment = "confirmed") => {
      if (!anchorWallet) {
        return
      }

      if (props.candyMachineId) {
        try {
          const cndy = await getCandyMachineState(
            anchorWallet,
            props.candyMachineId,
            connection
          )
          console.log("Candy machine state: ", cndy)
          let active = cndy?.state.goLiveDate
            ? cndy?.state.goLiveDate.toNumber() < new Date().getTime() / 1000
            : false
          let presale = false

          // duplication of state to make sure we have the right values!
          let isWLUser = false
          let userPrice = cndy.state.price

          // whitelist mint?
          if (cndy?.state.whitelistMintSettings) {
            // is it a presale mint?
            if (
              cndy.state.whitelistMintSettings.presale &&
              (!cndy.state.goLiveDate ||
                cndy.state.goLiveDate.toNumber() > new Date().getTime() / 1000)
            ) {
              presale = true
            }
            // is there a discount?
            if (cndy.state.whitelistMintSettings.discountPrice) {
              setDiscountPrice(cndy.state.whitelistMintSettings.discountPrice)
              userPrice = cndy.state.whitelistMintSettings.discountPrice
            } else {
              setDiscountPrice(undefined)
              // when presale=false and discountPrice=null, mint is restricted
              // to whitelist users only
              if (!cndy.state.whitelistMintSettings.presale) {
                cndy.state.isWhitelistOnly = true
              }
            }
            // retrieves the whitelist token
            const mint = new anchor.web3.PublicKey(
              cndy.state.whitelistMintSettings.mint
            )
            const token = (await getAtaForMint(mint, anchorWallet.publicKey))[0]

            try {
              const balance = await connection.getTokenAccountBalance(token)
              isWLUser = parseInt(balance.value.amount) > 0
              // only whitelist the user if the balance > 0
              setIsWhitelistUser(isWLUser)

              if (cndy.state.isWhitelistOnly) {
                active = isWLUser && (presale || active)
              }
            } catch (e) {
              setIsWhitelistUser(false)
              // no whitelist user, no mint
              if (cndy.state.isWhitelistOnly) {
                active = false
              }
              console.log(
                "There was a problem fetching whitelist token balance"
              )
              console.log(e)
            }
          }
          userPrice = isWLUser ? userPrice : cndy.state.price

          if (cndy?.state.tokenMint) {
            // retrieves the SPL token
            const mint = new anchor.web3.PublicKey(cndy.state.tokenMint)
            const token = (await getAtaForMint(mint, anchorWallet.publicKey))[0]
            try {
              const balance = await connection.getTokenAccountBalance(token)

              const valid = new anchor.BN(balance.value.amount).gte(userPrice)

              // only allow user to mint if token balance >  the user if the balance > 0
              setIsValidBalance(valid)
              active = active && valid
            } catch (e) {
              setIsValidBalance(false)
              active = false
              // no whitelist user, no mint
              console.log("There was a problem fetching SPL token balance")
              console.log(e)
            }
          } else {
            const balance = new anchor.BN(
              await connection.getBalance(anchorWallet.publicKey)
            )
            const valid = balance.gte(userPrice)
            setIsValidBalance(valid)
            active = active && valid
          }

          // datetime to stop the mint?
          if (cndy?.state.endSettings?.endSettingType.date) {
            setEndDate(toDate(cndy.state.endSettings.number))
            if (
              cndy.state.endSettings.number.toNumber() <
              new Date().getTime() / 1000
            ) {
              active = false
            }
          }
          // amount to stop the mint?
          if (cndy?.state.endSettings?.endSettingType.amount) {
            const limit = Math.min(
              cndy.state.endSettings.number.toNumber(),
              cndy.state.itemsAvailable
            )
            if (cndy.state.itemsRedeemed < limit) {
              setItemsRemaining(limit - cndy.state.itemsRedeemed)
            } else {
              setItemsRemaining(0)
              cndy.state.isSoldOut = true
            }
          } else {
            setItemsRemaining(cndy.state.itemsRemaining)
          }

          if (cndy.state.isSoldOut) {
            active = false
          }

          const [collectionPDA] = await getCollectionPDA(props.candyMachineId)
          const collectionPDAAccount = await connection.getAccountInfo(
            collectionPDA
          )

          setIsActive((cndy.state.isActive = active))
          setIsPresale((cndy.state.isPresale = presale))
          setCandyMachine(cndy)

          const txnEstimate =
            892 +
            (!!collectionPDAAccount && cndy.state.retainAuthority ? 182 : 0) +
            (cndy.state.tokenMint ? 66 : 0) +
            (cndy.state.whitelistMintSettings ? 34 : 0) +
            (cndy.state.whitelistMintSettings?.mode?.burnEveryTime ? 34 : 0) +
            (cndy.state.gatekeeper ? 33 : 0) +
            (cndy.state.gatekeeper?.expireOnUse ? 66 : 0)

          setNeedTxnSplit(txnEstimate > 1230)
        } catch (e) {
          if (e instanceof Error) {
            if (
              e.message === `Account does not exist ${props.candyMachineId}`
            ) {
              setAlertState({
                open: true,
                message: `Couldn't fetch candy machine state from candy machine with address: ${
                  props.candyMachineId
                }, using rpc: ${
                  // @ts-ignore
                  window.xnft?.solana.rpc
                }! You probably typed the REACT_APP_CANDY_MACHINE_ID value in wrong in your .env file, or you are using the wrong RPC!`,
                severity: "error",
                hideDuration: null,
              })
            } else if (
              e.message.startsWith("failed to get info about account")
            ) {
              setAlertState({
                open: true,
                message: `Couldn't fetch candy machine state with rpc: ${
                  // @ts-ignore
                  window.xnft?.solana.rpc
                }! This probably means you have an issue with the REACT_APP_SOLANA_RPC_HOST value in your .env file, or you are not using a custom RPC!`,
                severity: "error",
                hideDuration: null,
              })
            }
          } else {
            setAlertState({
              open: true,
              message: `${e}`,
              severity: "error",
              hideDuration: null,
            })
          }
          console.log(e)
        }
      } else {
        setAlertState({
          open: true,
          message: `Your REACT_APP_CANDY_MACHINE_ID value in the .env file doesn't look right! Make sure you enter it in as plain base-58 address!`,
          severity: "error",
          hideDuration: null,
        })
      }
    },
    [
      anchorWallet,
      props.candyMachineId,
      // // @ts-ignore
      window.xnft?.solana.rpc,
      connection,
    ]
  )

  const onMint = async (
    beforeTransactions: Transaction[] = [],
    afterTransactions: Transaction[] = []
  ) => {
    try {
      setIsUserMinting(true)
      if (wallet.connected && candyMachine?.program && wallet.publicKey) {
        let setupMint: SetupState | undefined
        if (needTxnSplit && setupTxn === undefined) {
          setAlertState({
            open: true,
            message: "Please sign account setup transaction",
            severity: "info",
          })
          setupMint = await createAccountsForMint(
            candyMachine,
            wallet.publicKey
          )
          let status: any = { err: true }
          if (setupMint.transaction) {
            status = await awaitTransactionSignatureConfirmation(
              setupMint.transaction,
              60,
              connection,
              true
            )
          }
          if (status && !status.err) {
            setSetupTxn(setupMint)
            setAlertState({
              open: true,
              message:
                "Setup transaction succeeded! Please sign minting transaction",
              severity: "info",
            })
          } else {
            setAlertState({
              open: true,
              message: "Mint failed! Please try again!",
              severity: "error",
            })
            setIsUserMinting(false)
            return
          }
        } else {
          setAlertState({
            open: true,
            message: "Please sign minting transaction",
            severity: "info",
          })
        }

        const mintResult = await mintOneToken(
          candyMachine,
          wallet.publicKey,
          beforeTransactions,
          afterTransactions,
          setupMint ?? setupTxn
        )

        let status: any = { err: true }
        let metadataStatus: anchor.web3.AccountInfo<Buffer> | null = null
        if (mintResult) {
          status = await awaitTransactionSignatureConfirmation(
            mintResult.mintTxId,
            60,
            connection,
            true
          )

          metadataStatus =
            await candyMachine.program.provider.connection.getAccountInfo(
              mintResult.metadataKey,
              "processed"
            )
          console.log("Metadata status: ", !!metadataStatus)
        }

        if (status && !status.err && metadataStatus) {
          // manual update since the refresh might not detect
          // the change immediately
          const remaining = itemsRemaining! - 1
          setItemsRemaining(remaining)
          setIsActive((candyMachine.state.isActive = remaining > 0))
          candyMachine.state.isSoldOut = remaining === 0
          setSetupTxn(undefined)
          setAlertState({
            open: true,
            message: "Congratulations! Mint succeeded!",
            severity: "success",
            hideDuration: 7000,
          })
          refreshCandyMachineState("processed")
        } else if (status && !status.err) {
          setAlertState({
            open: true,
            message:
              "Mint likely failed! Anti-bot SOL 0.01 fee potentially charged! Check the explorer to confirm the mint failed and if so, make sure you are eligible to mint before trying again.",
            severity: "error",
            hideDuration: 8000,
          })
          refreshCandyMachineState()
        } else {
          setAlertState({
            open: true,
            message: "Mint failed! Please try again!",
            severity: "error",
          })
          refreshCandyMachineState()
        }
      }
    } catch (error: any) {
      let message = error.msg || "Minting failed! Please try again!"
      if (!error.msg) {
        if (!error.message) {
          message = "Transaction timeout! Please try again."
        } else if (error.message.indexOf("0x137")) {
          console.log(error)
          message = `SOLD OUT!`
        } else if (error.message.indexOf("0x135")) {
          message = `Insufficient funds to mint. Please fund your wallet.`
        }
      } else {
        if (error.code === 311) {
          console.log(error)
          message = `SOLD OUT!`
          window.location.reload()
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`
        }
      }

      setAlertState({
        open: true,
        message,
        severity: "error",
      })
      // updates the candy machine state to reflect the latest
      // information on chain
      refreshCandyMachineState()
    } finally {
      setIsUserMinting(false)
    }
  }

  const toggleMintButton = () => {
    let active = !isActive || isPresale

    if (active) {
      if (candyMachine!.state.isWhitelistOnly && !isWhitelistUser) {
        active = false
      }
      if (endDate && Date.now() >= endDate.getTime()) {
        active = false
      }
    }

    if (
      isPresale &&
      candyMachine!.state.goLiveDate &&
      candyMachine!.state.goLiveDate.toNumber() <= new Date().getTime() / 1000
    ) {
      setIsPresale((candyMachine!.state.isPresale = false))
    }

    setIsActive((candyMachine!.state.isActive = active))
  }

  useEffect(() => {
    refreshCandyMachineState()
  }, [refreshCandyMachineState])

  useEffect(() => {
    ;(function loop() {
      setTimeout(() => {
        refreshCandyMachineState()
        loop()
      }, 20000)
    })()
  }, [refreshCandyMachineState])

  return (
    <View style={{ marginTop: 100 }}>
      <View maxWidth="xs" style={{ position: "relative" }}>
        <View
          style={{
            padding: 24,
            paddingBottom: 10,
            backgroundColor: "#151A1F",
            borderRadius: 6,
          }}
        >
          {!wallet.connected ? (
            <Button style={connectButtonStyles}>Connect Wallet</Button>
          ) : (
            <>
              {candyMachine && (
                <View
                  container
                  direction="row"
                  justifyContent="center"
                  wrap="nowrap"
                >
                  <View item xs={3}>
                    <Text variant="body2" color="textSecondary">
                      Remaining
                    </Text>
                    <Text
                      variant="h6"
                      color="textPrimary"
                      style={{
                        fontWeight: "bold",
                      }}
                    >
                      {`${itemsRemaining}`}
                    </Text>
                  </View>
                  <View item xs={4}>
                    <Text variant="body2" color="textSecondary">
                      {isWhitelistUser && discountPrice
                        ? "Discount Price"
                        : "Price"}
                    </Text>
                    <Text
                      variant="h6"
                      color="textPrimary"
                      style={{ fontWeight: "bold" }}
                    >
                      {isWhitelistUser && discountPrice
                        ? `◎ ${formatNumber.asNumber(discountPrice)}`
                        : `◎ ${formatNumber.asNumber(
                            candyMachine.state.price
                          )}`}
                    </Text>
                  </View>
                  <View item xs={5}>
                    {isActive && endDate && Date.now() < endDate.getTime() ? (
                      <>
                        <MintCountdown
                          key="endSettings"
                          date={getCountdownDate(candyMachine)}
                          style={{ justifyContent: "flex-end" }}
                          status="COMPLETED"
                          onComplete={toggleMintButton}
                        />
                        <Text
                          variant="caption"
                          align="center"
                          display="block"
                          style={{ fontWeight: "bold" }}
                        >
                          TO END OF MINT
                        </Text>
                      </>
                    ) : (
                      <>
                        <MintCountdown
                          key="goLive"
                          date={getCountdownDate(candyMachine)}
                          style={{ justifyContent: "flex-end" }}
                          status={
                            candyMachine?.state?.isSoldOut ||
                            (endDate && Date.now() > endDate.getTime())
                              ? "COMPLETED"
                              : isPresale
                              ? "PRESALE"
                              : "LIVE"
                          }
                          onComplete={toggleMintButton}
                        />
                        {isPresale &&
                          candyMachine.state.goLiveDate &&
                          candyMachine.state.goLiveDate.toNumber() >
                            new Date().getTime() / 1000 && (
                            <Text
                              variant="caption"
                              align="center"
                              display="block"
                              style={{ fontWeight: "bold" }}
                            >
                              UNTIL PUBLIC MINT
                            </Text>
                          )}
                      </>
                    )}
                  </View>
                </View>
              )}
              <View>
                {candyMachine?.state.isActive &&
                candyMachine?.state.gatekeeper &&
                wallet.publicKey &&
                wallet.signTransaction ? (
                  <GatewayProvider
                    wallet={{
                      publicKey:
                        wallet.publicKey ||
                        new PublicKey(CANDY_MACHINE_PROGRAM),
                      //@ts-ignore
                      signTransaction: wallet.signTransaction,
                    }}
                    gatekeeperNetwork={
                      candyMachine?.state?.gatekeeper?.gatekeeperNetwork
                    }
                    // @ts-ignore
                    clusterUrl={window.xnft.solana.rpc}
                    cluster={"mainnet-beta"}
                    options={{ autoShowModal: false }}
                  >
                    <MintButton
                      candyMachine={candyMachine}
                      isMinting={isUserMinting}
                      setIsMinting={(val) => setIsUserMinting(val)}
                      onMint={onMint}
                      isActive={
                        isActive ||
                        (isPresale && isWhitelistUser && isValidBalance)
                      }
                    />
                  </GatewayProvider>
                ) : (
                  <MintButton
                    candyMachine={candyMachine}
                    isMinting={isUserMinting}
                    setIsMinting={(val) => setIsUserMinting(val)}
                    onMint={onMint}
                    isActive={
                      isActive ||
                      (isPresale && isWhitelistUser && isValidBalance)
                    }
                  />
                )}
              </View>
            </>
          )}
          <Text
            variant="caption"
            align="center"
            display="block"
            style={{ marginTop: 7, color: "grey" }}
          >
            Powered by METAPLEX
          </Text>
        </View>
      </View>

      {/* <View
        open={alertState.open}
        autoHideDuration={
          alertState.hideDuration === undefined ? 6000 : alertState.hideDuration
        }
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Text
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Text>
      </View> */}
    </View>
  )
}

const getCountdownDate = (
  candyMachine: CandyMachineAccount
): Date | undefined => {
  if (
    candyMachine.state.isActive &&
    candyMachine.state.endSettings?.endSettingType.date
  ) {
    return toDate(candyMachine.state.endSettings.number)
  }

  return toDate(
    candyMachine.state.goLiveDate
      ? candyMachine.state.goLiveDate
      : candyMachine.state.isPresale
      ? new anchor.BN(new Date().getTime() / 1000)
      : undefined
  )
}

export default Minter
