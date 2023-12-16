import AsyncStorage from '@react-native-async-storage/async-storage'

export interface NexusReduxManipulateItem<T> {
	item: T
	callbackFunction?: (oldId: string, newId: string) => void
	isOnline: boolean
}
export interface NexusReduxSyncData {
	callbackFunction?: () => void
	isOnline: boolean
}

export interface NexusReduxProps<T> {
	async_DATA_KEY: string
	consoleDebug?: boolean
	idAttributeName?: keyof T
	modificationDateAttributeName?: keyof T
	startLoadData: () => void
	isOnline: boolean
	remoteMethods?: {
		GET?: () => Promise<T[]>
		CREATE?: (item: T) => Promise<T>
		UPDATE?: (item: T) => Promise<T>
		DELETE?: (item: string) => Promise<string>
	}
}

export class NexusRedux<T> {
	public data: T[]
	async_DATA_KEY: string

	consoleDebug?: boolean
	idAttributeName?: keyof T
	modificationDateAttributeName?: keyof T
	isOnline?: boolean
	remoteMethods?: {
		GET?: () => Promise<T[]>
		CREATE?: (item: T) => Promise<T>
		UPDATE?: (item: T) => Promise<T>
		DELETE?: (item: string) => Promise<string>
	}

	// CALLBACK FUNTIONS
	private startLoadData: () => void

	// STATES
	public alreadyRemoteLoaded: boolean = false // TODO: Uncomment when add ONLINE
	public loading = false
	public error = ''
	public hasDataChanged = false
	private hasDeletedChanged = false
	private numberOfChangesPending = 0
	public isRemoteDataUptoDate = false
	private syncingData = false

	private dataDeletedOffline: string[] = []

	// SINGLETON
	private static instance: NexusRedux<any> | undefined

	public static getInstance<U>(props: NexusReduxProps<U>): NexusRedux<U> {
		if (
			NexusRedux.instance &&
			NexusRedux.instance.async_DATA_KEY === props.async_DATA_KEY
		) {
			return NexusRedux.instance as NexusRedux<U>
		} else {
			const newInstance = new NexusRedux<U>(props)
			NexusRedux.instance = newInstance
			return newInstance
		}
	}

	private constructor(props: NexusReduxProps<T>) {
		this.data = []
		this.async_DATA_KEY = props.async_DATA_KEY

		this.startLoadData = props.startLoadData

		this.consoleDebug = props.consoleDebug
		this.idAttributeName = props.idAttributeName
		this.modificationDateAttributeName = props.modificationDateAttributeName
		this.remoteMethods = props.remoteMethods
		this.startLoadData = props.startLoadData
		this.isOnline = props.isOnline

		console.log(`ABOUT TO INITIAL FUNCTION | --------------`)
		this.initialFunction()
	}

	private async checkAndSaveLocalKeys() {
		AsyncStorage.getItem('NEXUSSYNC_KEYS').then((localKeysString) => {
			const localKeys = JSON.parse(localKeysString ?? '[]') as string[]
			if (!localKeys.includes(this.async_DATA_KEY)) {
				localKeys.push(this.async_DATA_KEY)
				AsyncStorage.setItem('NEXUSSYNC_KEYS', JSON.stringify(localKeys))
			}
		})
	}

	public deleteAllLocalSavedData() {
		AsyncStorage.getItem('NEXUSSYNC_KEYS').then((localKeysString) => {
			const localKeys = JSON.parse(localKeysString ?? '[]') as string[]

			localKeys.forEach((localKey) => {
				AsyncStorage.removeItem(localKey)
			})
		})
	}

	private async initialFunction() {
		this.checkAndSaveLocalKeys()

		console.log(`this.isOnline |=========>`, JSON.stringify(this.isOnline))
		if (this.isOnline) {
			this.getRemoteData()
		} else {
			this.getLocalData()
		}
	}

	// NETWORK LISTENER
	// useEffect(() => {
	//   const unsubscribe: NetInfoSubscription = NetInfo.addEventListener(
	//     (state: NetInfoState) => {
	//       if (state.isConnected !== null) {
	//         setIsOnline(state.isConnected);
	//       }
	//     }
	//   );
	//   return () => {
	//     unsubscribe();
	//   };
	// }, [])

	// useEffect(() => {
	//   if (isOnline === null) {
	//     return;
	//   }
	//   if (!isOnline) {
	//     // HERE THE MANUAL HANDLE FUNCTION
	//     setBackOnLine(true);
	//     return;
	//   }

	//   // HERE THE AUTOMATIC HANDLE FUNCTION
	//   if (props.autoRefreshOnBackOnline || !alreadyRemoteLoaded.current) {
	//     getRemoteData();
	//   }

	//   props.onBackOnline && props.onBackOnline();
	// }, [isOnline]);

	public async getRemoteData() {
		this.remoteMethods &&
			this.remoteMethods.GET &&
			this.remoteMethods
				.GET()
				.then((res) => {
					console.log(`DATA GETTED ${this.async_DATA_KEY}| --------------`)
					console.log(
						`res  ${this.async_DATA_KEY}|=========>`,
						JSON.stringify(res)
					)
					this.alreadyRemoteLoaded = true
					this.getOfflineDeletedData(res)
				})
				.finally(() => {
					this.loading = false
				})
				.catch((err: any) => {
					this.error = `ERROR NEXUSSYNC_003:` + JSON.stringify(err)
				})
	}

	private getOfflineDeletedData(remoteData: T[]) {
		console.log(`REDE TO GET OFFLINE DELETED DATA | --------------`)
		console.log(`remoteData |=========>`, JSON.stringify(remoteData))

		if (
			this.idAttributeName === undefined ||
			this.modificationDateAttributeName === undefined
		) {
			this.consoleDebug &&
				console.warn(
					`WARNING NEXUSSYNC_002: No idAttributeName or modificationDateAttributeName 
					Attribute provided on hook initialization, it means that will this component will works offline 
					and will be updated always local data and display Remote data `
				)

			this.data = remoteData

			this.startLoadData()
			this.startLoadData = () => {}
			return
		}

		let dataToDelete: string[] = []

		AsyncStorage.getItem(this.async_DATA_KEY + '_deleted')
			.then((localDataDeletedOfflineString) => {
				if (localDataDeletedOfflineString) {
					try {
						dataToDelete = JSON.parse(localDataDeletedOfflineString)
						this.hasDataChanged = true
					} catch {
						;(err: any) => {
							this.error = `ERROR NEXUSSYNC_005:` + JSON.stringify(err)
						}
					}
				}

				this.compareLocalVsRemoteData(remoteData, dataToDelete)
			})
			.catch((err: any) => {
				this.error = `ERROR NEXUSSYNC_004:` + JSON.stringify(err)
				this.compareLocalVsRemoteData(remoteData, [])
			})
	}

	private async getLocalData() {
		AsyncStorage.getItem(this.async_DATA_KEY)
			.then((localDataString) => {
				if (localDataString) {
					try {
						const localData: T[] = JSON.parse(localDataString)
						console.log(`localData X|=========>`, JSON.stringify(localData))

						this.data = localData

						this.startLoadData()
						this.startLoadData = () => {}
					} catch {
						;(err: any) => {
							this.error = `ERROR NEXUSSYNC_001:` + JSON.stringify(err)
						}
					}
				} else {
					console.log(`NO LOCAL DATA | --------------`)
				}
			})
			.catch((err: any) => {
				this.error = `ERROR NEXUSSYNC_002:` + JSON.stringify(err)
			})
	}

	/* SYNC FUNCTIONS */
	private syncEditedLocalItemsToRemote(
		dataToEdit: T[],
		dataWithoutChanges: T[],
		didSyncLocalDeletions: boolean
	) {
		if (this.remoteMethods && this.remoteMethods.UPDATE) {
			if (dataToEdit.length > 0) {
				let itemsFinal = dataWithoutChanges
				Promise.all(
					dataToEdit.map(async (itemToEdit) => {
						try {
							const itemEdited =
								this.remoteMethods &&
								this.remoteMethods.UPDATE &&
								this.remoteMethods.UPDATE(itemToEdit)

							return itemEdited
						} catch (err: any) {
							this.error = `ERROR NEXUSSYNC_022:` + JSON.stringify(err)
							return null
						}
					})
				)
					.then((itemsCreated) => {
						this.hasDataChanged = true
						const filteredItemsCreated: (T | null | undefined)[] =
							itemsCreated.filter((item) => item !== null)
						filteredItemsCreated.map((itemx) => {
							if (itemx !== null && itemx !== undefined) {
								itemsFinal.push(itemx)
							}
						})

						if (
							this.numberOfChangesPending &&
							this.numberOfChangesPending > 0
						) {
							this.numberOfChangesPending =
								this.numberOfChangesPending - dataToEdit.length
						}

						this.isRemoteDataUptoDate = didSyncLocalDeletions
						this.data = itemsFinal
						this.syncingData = false

						this.startLoadData()
						this.startLoadData = () => {}
						this.updateLocalData()
					})
					.catch((err: any) => {
						this.isRemoteDataUptoDate = didSyncLocalDeletions
						this.error = `ERROR NEXUSSYNC_010:` + JSON.stringify(err)
					})
			} else {
				this.isRemoteDataUptoDate = didSyncLocalDeletions
				this.data = dataWithoutChanges
				this.syncingData = false
				this.startLoadData()
				this.startLoadData = () => {}
				this.updateLocalData()
			}
		} else {
			if (dataToEdit.length > 0) {
				dataToEdit.map((itemx) => {
					if (itemx !== null && itemx !== undefined) {
						dataWithoutChanges.push(itemx)
					}
				})
			}

			this.isRemoteDataUptoDate =
				didSyncLocalDeletions && dataToEdit.length === 0
			this.data = dataWithoutChanges
			this.syncingData = false
			this.startLoadData()
			this.startLoadData = () => {}
			this.updateLocalData()
		}
	}

	private syncCreatedLocalItemsToRemote(
		dataToCreate: T[],
		dataToEdit: T[],
		dataWithoutChanges: T[],
		didSyncLocalDeletions: boolean
	) {
		if (this.remoteMethods && this.remoteMethods.CREATE) {
			let itemsFinal = dataWithoutChanges
			if (dataToCreate.length > 0) {
				Promise.all(
					dataToCreate.map(async (item) => {
						try {
							const itemCreated =
								this.remoteMethods &&
								this.remoteMethods.CREATE &&
								this.remoteMethods.CREATE(item)

							return itemCreated
						} catch (err: any) {
							this.error = `ERROR NEXUSSYNC_021:` + JSON.stringify(err)
							return null
						}
					})
				)
					.then((itemsCreated) => {
						this.hasDataChanged = true
						const filteredItemsCreated: (T | null | undefined)[] =
							itemsCreated.filter((item) => item !== null)
						filteredItemsCreated.map((itemx) => {
							if (itemx !== null && itemx !== undefined) {
								itemsFinal.push(itemx)
							}
						})

						if (
							this.numberOfChangesPending &&
							this.numberOfChangesPending > 0
						) {
							this.numberOfChangesPending =
								this.numberOfChangesPending - dataToCreate.length
						}

						this.syncEditedLocalItemsToRemote(
							dataToEdit,
							itemsFinal,
							didSyncLocalDeletions && true
						)
					})
					.catch((err: any) => {
						this.error = `ERROR NEXUSSYNC_009:` + JSON.stringify(err)
					})
			} else {
				this.syncEditedLocalItemsToRemote(
					dataToEdit,
					itemsFinal,
					didSyncLocalDeletions && true
				)
			}
		} else {
			if (dataToCreate.length > 0) {
				dataToCreate.map((itemx) => {
					if (itemx !== null && itemx !== undefined) {
						dataWithoutChanges.push(itemx)
					}
				})
			}

			this.syncEditedLocalItemsToRemote(
				dataToEdit,
				dataWithoutChanges,
				didSyncLocalDeletions && dataToCreate.length === 0
			)
		}
	}

	private syncDeletedLocalItemsToRemote(
		dataToDelete: string[],
		dataToCreate: T[],
		dataToEdit: T[],
		dataWithoutChanges: T[]
	) {
		let itemsFinal = dataWithoutChanges

		if (this.remoteMethods && this.remoteMethods.DELETE) {
			if (dataToDelete.length > 0) {
				Promise.all(
					dataToDelete.map(async (item) => {
						try {
							const itemDeleted =
								this.remoteMethods &&
								this.remoteMethods.DELETE &&
								this.remoteMethods.DELETE(item)

							return itemDeleted
						} catch (err: any) {
							this.consoleDebug &&
								console.log(`err C|=========>`, JSON.stringify(err))
							this.error = `ERROR NEXUSSYNC_020:` + JSON.stringify(err)
							return null
						}
					})
				)
					.then(() => {
						this.hasDeletedChanged = true
						this.dataDeletedOffline = []
						this.updateLocalDataDeletedOffline()

						if (
							this.numberOfChangesPending &&
							this.numberOfChangesPending > 0
						) {
							this.numberOfChangesPending =
								this.numberOfChangesPending - dataToDelete.length
						}

						this.syncCreatedLocalItemsToRemote(
							dataToCreate,
							dataToEdit,
							itemsFinal,
							true
						)
					})
					.catch((err: any) => {
						this.error = `ERROR NEXUSSYNC_008:` + JSON.stringify(err)
					})
			} else {
				this.syncCreatedLocalItemsToRemote(
					dataToCreate,
					dataToEdit,
					itemsFinal,
					true
				)
			}
		} else {
			this.syncCreatedLocalItemsToRemote(
				dataToCreate,
				dataToEdit,
				itemsFinal,
				dataToDelete.length === 0
			)
		}
	}

	private compareLocalVsRemoteData(remoteData: T[], dataToDelete: string[]) {
		console.log(`ABOUT TO COMPRARE LOCAL VS REMOTE DATA | --------------`)
		console.log(`remoteData |=========>`, JSON.stringify(remoteData))
		console.log(`dataToDelete |=========>`, JSON.stringify(dataToDelete))
		let dataToCreate: T[] = []
		let dataToEdit: T[] = []
		let dataWithoutChanges: T[] = []

		let itemFound = false
		let _hasDataChanged = false

		AsyncStorage.getItem(this.async_DATA_KEY)
			.then((localDataString) => {
				if (localDataString) {
					console.log(
						`localDataString XXXXX|=========>`,
						JSON.stringify(localDataString)
					)
					console.log(`remoteData yyYYY|=========>`, JSON.stringify(remoteData))
					try {
						// const localData: T[] = JSON.parse(localDataString);
						const localData: any[] = JSON.parse(localDataString)

						if (localData.length > 0) {
							for (const localItem of localData) {
								itemFound = false

								for (const remoteItem of remoteData) {
									if (this.idAttributeName !== undefined) {
										if (this.modificationDateAttributeName !== undefined) {
											if (
												localItem?.[this.idAttributeName] ==
												remoteItem?.[this.idAttributeName]
											) {
												itemFound = true

												if (
													localItem?.[this.modificationDateAttributeName] ==
													remoteItem?.[this.modificationDateAttributeName]
												) {
													// Local and Remote item are exactly the same
													dataWithoutChanges.push(localItem)
													break
												} else {
													// Different datetime
													const modificationDateLocalString: string =
														localItem?.[
															this.modificationDateAttributeName
														] as string

													const modificationDateRemoteString: string =
														remoteItem?.[
															this.modificationDateAttributeName
														] as string

													const localItemModificationDate = new Date(
														modificationDateLocalString
													)
													const remoteItemModificationDate = new Date(
														modificationDateRemoteString
													)

													if (
														localItemModificationDate >
														remoteItemModificationDate
													) {
														// Local modification datetime is more recent
														// Will upload local changes to remote
														dataToEdit.push(localItem)
													} else {
														// Remote modification datetime is more recent
														// Will update local item
														dataWithoutChanges.push(remoteItem)
														_hasDataChanged = true
													}
												}
											}
										}
									}
								}

								if (!itemFound) {
									// Local item is not in remote
									if (localItem?.createdOffline) {
										// Was created offile, will be created to Remote
										dataToCreate.push(localItem)
									} else {
										// Was deleted from Remote, will be deleted from Local and won't be created on Remote
										_hasDataChanged = true
									}
								}
							}

							// Checking which are in Remote but not in local
							let itemYa = false
							remoteData.map((remoteItem) => {
								itemYa = false
								localData.map((localItem) => {
									if (
										this.idAttributeName !== undefined &&
										remoteItem?.[this.idAttributeName] ==
											localItem?.[this.idAttributeName]
									) {
										itemYa = true
									}
								})

								if (
									this.idAttributeName !== undefined &&
									!itemYa &&
									!dataToDelete.includes(
										remoteItem?.[this.idAttributeName] as string
									)
								) {
									// this item is not in local
									dataWithoutChanges.push(remoteItem)
									_hasDataChanged = true
								}
							})
						} else {
							// If there is nothing local will take all Remote
							dataWithoutChanges = remoteData
							_hasDataChanged = true
						}
					} catch {
						;(err: any) => {
							this.error = `ERROR NEXUSSYNC_006:` + JSON.stringify(err)
						}
					}
				} else {
					// If there is nothing local will take all Remote
					console.log(`NO HAY LOCAL DATA | --------------`)

					dataWithoutChanges = remoteData
					_hasDataChanged = true
				}

				this.hasDataChanged = _hasDataChanged

				console.log(
					`this.isOnline ZZZZ|=========>`,
					JSON.stringify(this.isOnline)
				)
				console.log(
					`this.syncingData ZZZZ|=========>`,
					JSON.stringify(this.syncingData)
				)
				if (this.isOnline && !this.syncingData) {
					this.syncingData = true
					this.numberOfChangesPending =
						dataToDelete.length + dataToCreate.length + dataToEdit.length

					console.log(`ABOUT TO SYNC DATA DELETED LOCAL ITEMS | --------------`)

					this.syncDeletedLocalItemsToRemote(
						dataToDelete,
						dataToCreate,
						dataToEdit,
						dataWithoutChanges
					)
				} else {
					console.log(`SETTING THIS.DATA | --------------`)
					console.log(
						`dataWithoutChanges |=========>`,
						JSON.stringify(dataWithoutChanges)
					)
					// console.log(`localData |=========>`, JSON.stringify(localData))
					// this.data = dataWithoutChanges
					// this.startLoadData()
					this.getLocalData()
				}
			})
			.catch((err: any) => {
				this.error = `ERROR NEXUSSYNC_007:` + JSON.stringify(err)
			})
	}

	/* 
			--- REFRESH HANDLING --- 
	*/
	public refreshData() {
		// if (!isOnline) {
		console.log(`AOBUT TO REFRESH DATA GET LOCAL DATA 111 | --------------`)
		this.getLocalData()
		// } else {
		// getRemoteData && getRemoteData();
		// }
		// setBackOnLine(false);
	}

	public syncData(isOnline: boolean, callbackFunction?: () => void) {
		console.log(`isOnline PARA SYNC DATA|=========>`, JSON.stringify(isOnline))
		this.isOnline = isOnline
		if (isOnline) {
			console.log(`ABOUT TO SYNC DATA | --------------`)
			this.getRemoteData()
			callbackFunction && callbackFunction()
		}
	}

	/* 
			--- ASYNC STORAGE FUNCTIONS --- 
	*/
	private async updateLocalData() {
		// if(!this.hasDataChanged){
		//   return
		// }
		console.log(`xxxxxXXX ABOUT TO SYNC LOCAL DATA | --------------`)
		console.log(`props.data |=========>`, JSON.stringify(this.data))
		await AsyncStorage.setItem(this.async_DATA_KEY, JSON.stringify(this.data))
	}

	private async updateLocalDataDeletedOffline() {
		await AsyncStorage.setItem(
			this.async_DATA_KEY + '_deleted',
			JSON.stringify(this.dataDeletedOffline)
		)
	}

	/* 
			--- HELPER FUNCTIONS  --- 
	*/
	private updateItemFromContext(id: any, new_item: T): T[] {
		const updatedItems = this.data.map((item) => {
			if (this.idAttributeName && item[this.idAttributeName] == id) {
				let newItem: any = {
					...new_item
				}
				newItem[this.idAttributeName] = id
				return newItem
			}
			return item
		})

		return updatedItems
	}

	private deleteItemFromContext(id: string): T[] {
		if (this.idAttributeName !== undefined) {
			const updatedItems = this.data.filter(
				(item) => item[this.idAttributeName as keyof T] != id
			)
			return updatedItems
		}
		return this.data
	}

	/* 
			--- EXPORTABLE CRUD FUNCTIONS --- 
	*/
	public async saveItem(
		item: T,
		callbackFunction?: (oldId: string, newId: string) => void,
		isOnline?: boolean
	): Promise<T> {
		this.loading = true

		// CREATE ITEM
		console.log(`isOnline |=========>`, JSON.stringify(isOnline))
		console.log('SAVING ')
		if (isOnline && this.remoteMethods && this.remoteMethods.CREATE) {
			try {
				this.hasDataChanged = true
				const createdItem = await this.remoteMethods.CREATE(item)
				this.data = [...this.data, createdItem]
				this.loading = false

				if (this.idAttributeName) {
					callbackFunction &&
						callbackFunction(
							item[this.idAttributeName] as string,
							createdItem[this.idAttributeName] as string
						)
				}

				this.updateLocalData()

				return createdItem
			} catch (err: any) {
				this.error = `ERROR NEXUSSYNC_011:` + JSON.stringify(err)
				this.loading = false
				return Promise.reject(`ERROR NEXUSSYNC_011:` + JSON.stringify(err))
			}
		} else {
			// ONLY SAVE IN LOCAL OFFLINE
			console.log('SAVING LOCAL')

			if (
				this.idAttributeName !== undefined &&
				this.modificationDateAttributeName
			) {
				console.log(`TO CREATE OFFLINE SSSSSS | --------------`)
				const currentDate = new Date()
				const formattedDate = currentDate
					.toISOString()
					.slice(0, 19)
					.replace('T', ' ')

				this.hasDataChanged = true

				let newItem: any = {
					...item,
					createdOffline: true
				}
				newItem[this.modificationDateAttributeName] = formattedDate
				newItem[this.idAttributeName] = new Date().getTime().toString()

				this.data = [...this.data, newItem]

				console.log(`ABOUT TO CALL CALLBACK FUNTION | --------------`)

				if (this.idAttributeName) {
					try {
						callbackFunction &&
							callbackFunction(
								item[this.idAttributeName] as string,
								newItem[this.idAttributeName] as string
							)
					} catch (err) {
						console.log(`err ZZZZZZZZ|=========>`, err)
					}
				}
				console.log(`ABOUT TO UPDATE LOCAL DATA | --------------`)
				this.updateLocalData()
				this.loading = false
				return newItem
			} else {
				console.warn(
					`WARNING NEXUSSYNC_003: No idAttributeName or modificationDateAttributeName 
						Attribute provided on hook initialization, can not create local item`
				)
				this.loading = false
				return Promise.reject(`ERROR NEXUSSYNC_0133: unkpnw`)
			}
		}
	}

	public async updateItem(
		item: T,
		callbackFunction?: (oldId: string, newId: string) => void,
		isOnline?: boolean
	): Promise<T> {
		if (
			this.idAttributeName === undefined ||
			this.modificationDateAttributeName === undefined
		) {
			console.warn(
				`WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization`
			)
			this.error = `WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization`
			return Promise.reject(
				'WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization'
			)
		}

		this.loading = true

		// UPDATE ITEM
		if (isOnline && this.remoteMethods && this.remoteMethods.UPDATE) {
			try {
				this.hasDataChanged = true
				const updatedItem = await this.remoteMethods.UPDATE(item)
				this.data = this.updateItemFromContext(
					item[this.idAttributeName as keyof T],
					updatedItem
				)

				if (this.idAttributeName) {
					callbackFunction &&
						callbackFunction(
							item[this.idAttributeName] as string,
							updatedItem[this.idAttributeName] as string
						)
				}

				this.updateLocalData()
				this.loading = false
				return updatedItem
			} catch (err: any) {
				this.error = `ERROR NEXUSSYNC_012:` + JSON.stringify(err)
				this.loading = false
				return Promise.reject(`ERROR NEXUSSYNC_012:` + JSON.stringify(err))
			}
		} else {
			console.log(`UPDATING ITEM LOCALLLY | --------------`)
			// ONLY SAVE IN LOCAL OFFLINE
			const currentDate = new Date()
			const formattedDate = currentDate
				.toISOString()
				.slice(0, 19)
				.replace('T', ' ')

			this.hasDataChanged = true

			let editedItem: any = {
				...item
			}
			editedItem[this.modificationDateAttributeName] = formattedDate

			this.data = this.updateItemFromContext(
				item?.[this.idAttributeName] as string,
				editedItem
			)

			if (this.idAttributeName) {
				callbackFunction &&
					callbackFunction(
						item[this.idAttributeName] as string,
						editedItem[this.idAttributeName] as string
					)
			}

			this.updateLocalData()
			this.loading = false
			return editedItem
		}
	}

	public async deleteItem(
		item: T,
		callbackFunction?: (oldId: string, newId: string) => void,
		isOnline?: boolean
	) {
		if (this.idAttributeName === undefined) {
			console.warn(
				`WARNING NEXUSSYNC_001: Can not delete item due to idAttributeName not provided on hook initialization`
			)
			this.error = `WARNING NEXUSSYNC_001: Can not delete item due to idAttributeName not provided on hook initialization`
			return
		}

		this.loading = true

		if (
			isOnline &&
			this.remoteMethods &&
			this.remoteMethods.DELETE &&
			this.idAttributeName
		) {
			try {
				this.hasDataChanged = true
				await this.remoteMethods.DELETE(item?.[this.idAttributeName] as string)
				this.data = this.deleteItemFromContext(
					item?.[this.idAttributeName] as string
				)
				if (this.idAttributeName) {
					callbackFunction &&
						callbackFunction(
							item[this.idAttributeName] as string,
							item[this.idAttributeName] as string
						)
				}

				this.updateLocalData()
				this.loading = false
			} catch {
				;(err: any) => {
					this.error = `ERROR NEXUSSYNC_013:` + JSON.stringify(err)
					this.loading = false
				}
			}
		} else {
			// ONLY IN LOCAL OFFLINE
			this.hasDataChanged = true
			this.hasDeletedChanged = true
			if (this.idAttributeName) {
				this.data = this.deleteItemFromContext(
					item?.[this.idAttributeName] as string
				)
				this.dataDeletedOffline = [
					...this.dataDeletedOffline,
					item?.[this.idAttributeName] as string
				]

				if (this.hasDeletedChanged) {
					this.updateLocalDataDeletedOffline()
				}

				if (this.idAttributeName) {
					callbackFunction &&
						callbackFunction(
							item[this.idAttributeName] as string,
							item[this.idAttributeName] as string
						)
				}
				this.updateLocalData()
			}

			this.loading = false
		}
	}
}
