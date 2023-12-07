import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NexusReduxProps<T> {
  data?: T[];
  async_DATA_KEY: string;
  useMethodsOnly?: boolean;
  syncRemoteData?: boolean;
  syncLocalData?: boolean;
  consoleDebug?: boolean;
  idAttributeName?: keyof T;
  modificationDateAttributeName?: keyof T;
  loadFirstRemote?: boolean; // Will load local data by default
  autoRefreshOnBackOnline?: boolean;
  onBackOnline?: () => any;
  startLoadData: () => void;
  remoteMethods?: {
    GET?: () => Promise<T[]>;
    CREATE?: (item: T) => Promise<T>;
    UPDATE?: (item: T) => Promise<T>;
    DELETE?: (item: string) => Promise<string>;
  };
}

export class NexusRedux<T> {
  public data: T[];
  // setData: (val: T[]) => void;
  async_DATA_KEY: string;
  useMethodsOnly?: boolean;
  syncRemoteData?: boolean;
  syncLocalData?: boolean;
  consoleDebug?: boolean;
  idAttributeName?: keyof T;
  modificationDateAttributeName?: keyof T;
  loadFirstRemote?: boolean; // Will load local data by default
  autoRefreshOnBackOnline?: boolean;
  onBackOnline?: () => any;
  remoteMethods?: {
    GET?: () => Promise<T[]>;
    CREATE?: (item: T) => Promise<T>;
    UPDATE?: (item: T) => Promise<T>;
    DELETE?: (item: string) => Promise<string>;
  };

  // CALLBACK FUNTIONS
  private startLoadData: () => void;

  // STATES
  public alreadyRemoteLoaded: boolean = false; // TODO: Uncomment when add ONLINE
  public loading = false;
  public error = '';
  public hasDataChanged = false;
  private hasDeletedChanged = false;
  private numberOfChangesPending = 0;
  public isRemoteDataUptoDate = false;
  private syncingData = false;

  private dataDeletedOffline: string[] = [];

  // SINGLETON
  private static instance: NexusRedux<any> | undefined;

  public static getInstance<U>(props: NexusReduxProps<U>): NexusRedux<U> {
    console.log(`ABPOUT TO GET INSTANCE | --------------`);
    if (NexusRedux.instance) {
      return NexusRedux.instance as NexusRedux<U>;
    } else {
      const newInstance = new NexusRedux<U>(props);
      NexusRedux.instance = newInstance;
      return newInstance;
    }
  }

  private constructor(props: NexusReduxProps<T>) {
    this.data = props.data ?? [];
    this.async_DATA_KEY = props.async_DATA_KEY;

    this.startLoadData = props.startLoadData;

    this.useMethodsOnly = props.useMethodsOnly;
    this.syncRemoteData = props.syncRemoteData;
    this.syncLocalData = props.syncLocalData;
    this.consoleDebug = props.consoleDebug;
    this.idAttributeName = props.idAttributeName;
    this.modificationDateAttributeName = props.modificationDateAttributeName;
    this.loadFirstRemote = props.loadFirstRemote;
    this.autoRefreshOnBackOnline = props.autoRefreshOnBackOnline;
    this.onBackOnline = props.onBackOnline;
    this.remoteMethods = props.remoteMethods;
    this.startLoadData = props.startLoadData;

    console.log(`ABOUT TO INITIAL FUNCTION | --------------`);
    this.initialFunction();
  }

  private async checkAndSaveLocalKeys() {
    AsyncStorage.getItem('NEXUSSYNC_KEYS').then((localKeysString) => {
      const localKeys = JSON.parse(localKeysString ?? '[]') as string[];
      if (!localKeys.includes(this.async_DATA_KEY)) {
        localKeys.push(this.async_DATA_KEY);
        AsyncStorage.setItem('NEXUSSYNC_KEYS', JSON.stringify(localKeys));
      }
    });
  }

  public deleteAllLocalSavedData() {
    AsyncStorage.getItem('NEXUSSYNC_KEYS').then((localKeysString) => {
      const localKeys = JSON.parse(localKeysString ?? '[]') as string[];

      localKeys.forEach((localKey) => {
        AsyncStorage.removeItem(localKey);
      });
    });
  }

  private async initialFunction() {
    this.checkAndSaveLocalKeys();

    if (this.useMethodsOnly) {
      return;
    }
    if (
      !this.loadFirstRemote ||
      this.remoteMethods === undefined ||
      this.remoteMethods.GET === undefined
    ) {
      this.getLocalData();
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
    // TODO: change to private when adding this functionality
    if (this.useMethodsOnly) {
      return;
    }

    this.remoteMethods &&
      this.remoteMethods.GET &&
      this.remoteMethods
        .GET()
        .then((res) => {
          this.alreadyRemoteLoaded = true;
          this.getOfflineDeletedData(res);
        })
        .finally(() => {
          this.loading = false;
        })
        .catch((err: any) => {
          this.error = `ERROR NEXUSSYNC_003:` + JSON.stringify(err);
        });
  }

  private getOfflineDeletedData(remoteData: T[]) {
    if (this.useMethodsOnly) {
      return;
    }

    if (
      this.idAttributeName === undefined ||
      this.modificationDateAttributeName === undefined
    ) {
      this.consoleDebug &&
        console.warn(
          `WARNING NEXUSSYNC_002: No idAttributeName or modificationDateAttributeName 
					Attribute provided on hook initialization, it means that will this component will works offline 
					and will be updated always local data and display Remote data `
        );

      this.data = remoteData;
      return;
    }

    let dataToDelete: string[] = [];

    AsyncStorage.getItem(this.async_DATA_KEY + '_deleted')
      .then((localDataDeletedOfflineString) => {
        if (localDataDeletedOfflineString) {
          try {
            dataToDelete = JSON.parse(localDataDeletedOfflineString);
            this.hasDataChanged = true;
          } catch {
            (err: any) => {
              this.error = `ERROR NEXUSSYNC_005:` + JSON.stringify(err);
            };
          }
        }

        this.compareLocalVsRemoteData(remoteData, dataToDelete);
      })
      .catch((err: any) => {
        this.error = `ERROR NEXUSSYNC_004:` + JSON.stringify(err);
        this.compareLocalVsRemoteData(remoteData, []);
      });
  }

  private async getLocalData() {
    if (this.useMethodsOnly) {
      return;
    }

    // try {
    // 	const localDataString = await AsyncStorage.getItem(this.async_DATA_KEY)
    // 	if (localDataString) {
    // 		try {
    // 			const localData: T[] = JSON.parse(localDataString)
    // 			console.log(`localData X|=========>`, JSON.stringify(localData))

    // 			this.data = localData

    // 			this.startLoadData()

    // 			console.log(`this.data |=========>`, JSON.stringify(this.data))
    // 		} catch {
    // 			;(err: any) => {
    // 				this.error = `ERROR NEXUSSYNC_001:` + JSON.stringify(err)
    // 			}
    // 		}
    // 	} else {
    // 		console.log(`NO LOCAL DATA | --------------`)
    // 	}
    // } catch (err) {
    // 	this.error = `ERROR NEXUSSYNC_002:` + JSON.stringify(err)
    // }

    AsyncStorage.getItem(this.async_DATA_KEY)
      .then((localDataString) => {
        if (localDataString) {
          try {
            const localData: T[] = JSON.parse(localDataString);
            console.log(`localData X|=========>`, JSON.stringify(localData));

            this.startLoadData();

            this.data = localData;
          } catch {
            (err: any) => {
              this.error = `ERROR NEXUSSYNC_001:` + JSON.stringify(err);
            };
          }
        } else {
          console.log(`NO LOCAL DATA | --------------`);
        }
      })
      .catch((err: any) => {
        this.error = `ERROR NEXUSSYNC_002:` + JSON.stringify(err);
      });
  }

  /* SYNC FUNCTIONS */
  private syncEditedLocalItemsToRemote(
    dataToEdit: T[],
    dataWithoutChanges: T[],
    didSyncLocalDeletions: boolean
  ) {
    if (this.useMethodsOnly) {
      return;
    }

    if (this.remoteMethods && this.remoteMethods.UPDATE) {
      if (dataToEdit.length > 0) {
        let itemsFinal = dataWithoutChanges;
        Promise.all(
          dataToEdit.map(async (itemToEdit) => {
            try {
              const itemEdited =
                this.remoteMethods &&
                this.remoteMethods.UPDATE &&
                this.remoteMethods.UPDATE(itemToEdit);

              return itemEdited;
            } catch (err: any) {
              this.error = `ERROR NEXUSSYNC_022:` + JSON.stringify(err);
              return null;
            }
          })
        )
          .then((itemsCreated) => {
            this.hasDataChanged = true;
            const filteredItemsCreated: (T | null | undefined)[] =
              itemsCreated.filter((item) => item !== null);
            filteredItemsCreated.map((itemx) => {
              if (itemx !== null && itemx !== undefined) {
                itemsFinal.push(itemx);
              }
            });

            if (
              this.numberOfChangesPending &&
              this.numberOfChangesPending > 0
            ) {
              this.numberOfChangesPending =
                this.numberOfChangesPending - dataToEdit.length;
            }

            this.isRemoteDataUptoDate = didSyncLocalDeletions;
            this.data = itemsFinal;

            this.syncingData = false;
          })
          .catch((err: any) => {
            this.isRemoteDataUptoDate = didSyncLocalDeletions;
            this.error = `ERROR NEXUSSYNC_010:` + JSON.stringify(err);
          });
      } else {
        this.isRemoteDataUptoDate = didSyncLocalDeletions;
        this.data = dataWithoutChanges;
        this.syncingData = false;
      }
    } else {
      if (dataToEdit.length > 0) {
        dataToEdit.map((itemx) => {
          if (itemx !== null && itemx !== undefined) {
            dataWithoutChanges.push(itemx);
          }
        });
      }

      this.isRemoteDataUptoDate =
        didSyncLocalDeletions && dataToEdit.length === 0;
      this.data = dataWithoutChanges;
      this.syncingData = false;
    }
  }

  private syncCreatedLocalItemsToRemote(
    dataToCreate: T[],
    dataToEdit: T[],
    dataWithoutChanges: T[],
    didSyncLocalDeletions: boolean
  ) {
    if (this.useMethodsOnly) {
      return;
    }

    if (this.remoteMethods && this.remoteMethods.CREATE) {
      let itemsFinal = dataWithoutChanges;
      if (dataToCreate.length > 0) {
        Promise.all(
          dataToCreate.map(async (item) => {
            try {
              const itemCreated =
                this.remoteMethods &&
                this.remoteMethods.CREATE &&
                this.remoteMethods.CREATE(item);

              return itemCreated;
            } catch (err: any) {
              this.error = `ERROR NEXUSSYNC_021:` + JSON.stringify(err);
              return null;
            }
          })
        )
          .then((itemsCreated) => {
            this.hasDataChanged = true;
            const filteredItemsCreated: (T | null | undefined)[] =
              itemsCreated.filter((item) => item !== null);
            filteredItemsCreated.map((itemx) => {
              if (itemx !== null && itemx !== undefined) {
                itemsFinal.push(itemx);
              }
            });

            if (
              this.numberOfChangesPending &&
              this.numberOfChangesPending > 0
            ) {
              this.numberOfChangesPending =
                this.numberOfChangesPending - dataToCreate.length;
            }

            this.syncEditedLocalItemsToRemote(
              dataToEdit,
              itemsFinal,
              didSyncLocalDeletions && true
            );
          })
          .catch((err: any) => {
            this.error = `ERROR NEXUSSYNC_009:` + JSON.stringify(err);
          });
      } else {
        this.syncEditedLocalItemsToRemote(
          dataToEdit,
          itemsFinal,
          didSyncLocalDeletions && true
        );
      }
    } else {
      if (dataToCreate.length > 0) {
        dataToCreate.map((itemx) => {
          if (itemx !== null && itemx !== undefined) {
            dataWithoutChanges.push(itemx);
          }
        });
      }

      this.syncEditedLocalItemsToRemote(
        dataToEdit,
        dataWithoutChanges,
        didSyncLocalDeletions && dataToCreate.length === 0
      );
    }
  }

  private syncDeletedLocalItemsToRemote(
    dataToDelete: string[],
    dataToCreate: T[],
    dataToEdit: T[],
    dataWithoutChanges: T[]
  ) {
    if (this.useMethodsOnly) {
      return;
    }

    let itemsFinal = dataWithoutChanges;

    if (this.remoteMethods && this.remoteMethods.DELETE) {
      if (dataToDelete.length > 0) {
        Promise.all(
          dataToDelete.map(async (item) => {
            try {
              const itemDeleted =
                this.remoteMethods &&
                this.remoteMethods.DELETE &&
                this.remoteMethods.DELETE(item);

              return itemDeleted;
            } catch (err: any) {
              this.consoleDebug &&
                console.log(`err C|=========>`, JSON.stringify(err));
              this.error = `ERROR NEXUSSYNC_020:` + JSON.stringify(err);
              return null;
            }
          })
        )
          .then(() => {
            this.hasDeletedChanged = true;
            this.dataDeletedOffline = [];
            this.updateLocalDataDeletedOffline();

            if (
              this.numberOfChangesPending &&
              this.numberOfChangesPending > 0
            ) {
              this.numberOfChangesPending =
                this.numberOfChangesPending - dataToDelete.length;
            }

            this.syncCreatedLocalItemsToRemote(
              dataToCreate,
              dataToEdit,
              itemsFinal,
              true
            );
          })
          .catch((err: any) => {
            this.error = `ERROR NEXUSSYNC_008:` + JSON.stringify(err);
          });
      } else {
        this.syncCreatedLocalItemsToRemote(
          dataToCreate,
          dataToEdit,
          itemsFinal,
          true
        );
      }
    } else {
      this.syncCreatedLocalItemsToRemote(
        dataToCreate,
        dataToEdit,
        itemsFinal,
        dataToDelete.length === 0
      );
    }
  }

  private compareLocalVsRemoteData(remoteData: T[], dataToDelete: string[]) {
    if (this.useMethodsOnly) {
      return;
    }
    let dataToCreate: T[] = [];
    let dataToEdit: T[] = [];
    let dataWithoutChanges: T[] = [];

    let itemFound = false;
    let _hasDataChanged = false;

    AsyncStorage.getItem(this.async_DATA_KEY)
      .then((localDataString) => {
        if (localDataString) {
          console.log(
            `localDataString XXXXX|=========>`,
            JSON.stringify(localDataString)
          );
          console.log(
            `remoteData yyYYY|=========>`,
            JSON.stringify(remoteData)
          );
          try {
            // const localData: T[] = JSON.parse(localDataString);
            const localData: any[] = JSON.parse(localDataString);

            if (localData.length > 0) {
              for (const localItem of localData) {
                itemFound = false;

                for (const remoteItem of remoteData) {
                  if (this.idAttributeName !== undefined) {
                    if (this.modificationDateAttributeName !== undefined) {
                      if (
                        localItem?.[this.idAttributeName] ==
                        remoteItem?.[this.idAttributeName]
                      ) {
                        itemFound = true;

                        if (
                          localItem?.[this.modificationDateAttributeName] ==
                          remoteItem?.[this.modificationDateAttributeName]
                        ) {
                          // Local and Remote item are exactly the same
                          dataWithoutChanges.push(localItem);
                          break;
                        } else {
                          // Different datetime
                          const modificationDateLocalString: string =
                            localItem?.[
                              this.modificationDateAttributeName
                            ] as string;

                          const modificationDateRemoteString: string =
                            remoteItem?.[
                              this.modificationDateAttributeName
                            ] as string;

                          const localItemModificationDate = new Date(
                            modificationDateLocalString
                          );
                          const remoteItemModificationDate = new Date(
                            modificationDateRemoteString
                          );

                          if (
                            localItemModificationDate >
                            remoteItemModificationDate
                          ) {
                            // Local modification datetime is more recent
                            // Will upload local changes to remote
                            dataToEdit.push(localItem);
                          } else {
                            // Remote modification datetime is more recent
                            // Will update local item
                            dataWithoutChanges.push(remoteItem);
                            _hasDataChanged = true;
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
                    dataToCreate.push(localItem);
                  } else {
                    // Was deleted from Remote, will be deleted from Local and won't be created on Remote
                    _hasDataChanged = true;
                  }
                }
              }

              // Checking which are in Remote but not in local
              let itemYa = false;
              remoteData.map((remoteItem) => {
                itemYa = false;
                localData.map((localItem) => {
                  if (
                    this.idAttributeName !== undefined &&
                    remoteItem?.[this.idAttributeName] ==
                      localItem?.[this.idAttributeName]
                  ) {
                    itemYa = true;
                  }
                });

                if (
                  this.idAttributeName !== undefined &&
                  !itemYa &&
                  !dataToDelete.includes(
                    remoteItem?.[this.idAttributeName] as string
                  )
                ) {
                  // this item is not in local
                  dataWithoutChanges.push(remoteItem);
                  _hasDataChanged = true;
                }
              });
            } else {
              // If there is nothing local will take all Remote
              dataWithoutChanges = remoteData;
              _hasDataChanged = true;
            }
          } catch {
            (err: any) => {
              this.error = `ERROR NEXUSSYNC_006:` + JSON.stringify(err);
            };
          }
        } else {
          // If there is nothing local will take all Remote

          dataWithoutChanges = remoteData;
          _hasDataChanged = true;
        }

        this.hasDataChanged = _hasDataChanged;

        if (/*isOnline &&*/ this.syncRemoteData && !this.syncingData) {
          this.syncingData = true;
          this.numberOfChangesPending =
            dataToDelete.length + dataToCreate.length + dataToEdit.length;

          this.syncDeletedLocalItemsToRemote(
            dataToDelete,
            dataToCreate,
            dataToEdit,
            dataWithoutChanges
          );
        } else {
          this.data = dataWithoutChanges;
        }
      })
      .catch((err: any) => {
        this.error = `ERROR NEXUSSYNC_007:` + JSON.stringify(err);
      });
  }

  /* 
			--- REFRESH HANDLING --- 
	*/
  public refreshData() {
    if (this.useMethodsOnly) {
      return;
    }
    // if (!isOnline) {
    this.getLocalData();
    // } else {
    // getRemoteData && getRemoteData();
    // }
    // setBackOnLine(false);
  }

  /* 
			--- ASYNC STORAGE FUNCTIONS --- 
	*/
  private async updateLocalData() {
    // if(!this.hasDataChanged){
    //   return
    // }
    console.log(`xxxxxXXX ABOUT TO SYNC LOCAL DATA | --------------`);
    console.log(`props.data |=========>`, JSON.stringify(this.data));
    await AsyncStorage.setItem(this.async_DATA_KEY, JSON.stringify(this.data));
  }

  private async updateLocalDataDeletedOffline() {
    await AsyncStorage.setItem(
      this.async_DATA_KEY + '_deleted',
      JSON.stringify(this.dataDeletedOffline)
    );
  }

  /* 
			--- HELPER FUNCTIONS  --- 
	*/
  private updateItemFromContext(id: any, new_item: T): T[] {
    const updatedItems = this.data.map((item) => {
      if (this.idAttributeName && item[this.idAttributeName] == id) {
        let newItem: any = {
          ...new_item,
        };
        newItem[this.idAttributeName] = id;
        return newItem;
      }
      return item;
    });

    return updatedItems;
  }

  private deleteItemFromContext(id: string): T[] {
    if (this.idAttributeName !== undefined) {
      const updatedItems = this.data.filter(
        (item) => item[this.idAttributeName as keyof T] != id
      );
      return updatedItems;
    }
    return this.data;
  }

  /* 
			--- EXPORTABLE CRUD FUNCTIONS --- 
	*/
  public async saveItem(item: T): Promise<T> {
    this.loading = true;

    // CREATE ITEM
    console.log('SAVING ');
    if (/*this.isOnline &&*/ this.remoteMethods && this.remoteMethods.CREATE) {
      try {
        this.hasDataChanged = true;
        const createdItem = await this.remoteMethods.CREATE(item);
        this.data = [...this.data, createdItem];
        this.loading = false;

        this.updateLocalData();

        return createdItem;
      } catch (err: any) {
        this.error = `ERROR NEXUSSYNC_011:` + JSON.stringify(err);
        this.loading = false;
        return Promise.reject(`ERROR NEXUSSYNC_011:` + JSON.stringify(err));
      }
    } else {
      // ONLY SAVE IN LOCAL OFFLINE
      console.log('SAVING LOCAL');

      if (
        this.idAttributeName !== undefined &&
        this.modificationDateAttributeName
      ) {
        const currentDate = new Date();
        const formattedDate = currentDate
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');

        this.hasDataChanged = true;

        let newItem: any = {
          ...item,
          createdOffline: true,
        };
        newItem[this.modificationDateAttributeName] = formattedDate;
        newItem[this.idAttributeName] = new Date().getTime().toString();

        this.data = [...this.data, newItem];

        this.updateLocalData();
        this.loading = false;
        return newItem;
      } else {
        console.warn(
          `WARNING NEXUSSYNC_003: No idAttributeName or modificationDateAttributeName 
						Attribute provided on hook initialization, can not create local item`
        );
        this.loading = false;
        return Promise.reject(`ERROR NEXUSSYNC_0133: unkpnw`);
      }
    }
  }

  public async updateItem(item: T): Promise<T> {
    if (
      this.idAttributeName === undefined ||
      this.modificationDateAttributeName === undefined
    ) {
      console.warn(
        `WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization`
      );
      this.error = `WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization`;
      return Promise.reject(
        'WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization'
      );
    }

    this.loading = true;

    // UPDATE ITEM
    if (/*this.isOnline &&*/ this.remoteMethods && this.remoteMethods.UPDATE) {
      try {
        this.hasDataChanged = true;
        const updatedItem = await this.remoteMethods.UPDATE(item);
        this.data = this.updateItemFromContext(
          item[this.idAttributeName as keyof T],
          updatedItem
        );

        this.updateLocalData();

        this.loading = false;
        return updatedItem;
      } catch (err: any) {
        this.error = `ERROR NEXUSSYNC_012:` + JSON.stringify(err);
        this.loading = false;
        return Promise.reject(`ERROR NEXUSSYNC_012:` + JSON.stringify(err));
      }
    } else {
      console.log(`UPDATING ITEM LOCALLLY | --------------`);
      // ONLY SAVE IN LOCAL OFFLINE
      const currentDate = new Date();
      const formattedDate = currentDate
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');

      this.hasDataChanged = true;

      let editedItem: any = {
        ...item,
      };
      editedItem[this.modificationDateAttributeName] = formattedDate;

      this.data = this.updateItemFromContext(
        item?.[this.idAttributeName] as string,
        editedItem
      );

      this.updateLocalData();

      this.loading = false;
      return editedItem;
    }
  }

  public async deleteItem(item: T) {
    if (this.idAttributeName === undefined) {
      console.warn(
        `WARNING NEXUSSYNC_001: Can not delete item due to idAttributeName not provided on hook initialization`
      );
      this.error = `WARNING NEXUSSYNC_001: Can not delete item due to idAttributeName not provided on hook initialization`;
      return;
    }

    this.loading = true;

    if (
      /*isOnline &&*/
      this.remoteMethods &&
      this.remoteMethods.DELETE &&
      this.idAttributeName
    ) {
      try {
        this.hasDataChanged = true;
        await this.remoteMethods.DELETE(item?.[this.idAttributeName] as string);
        this.data = this.deleteItemFromContext(
          item?.[this.idAttributeName] as string
        );
        this.updateLocalData();

        this.loading = false;
      } catch {
        (err: any) => {
          this.error = `ERROR NEXUSSYNC_013:` + JSON.stringify(err);
          this.loading = false;
        };
      }
    } else {
      // ONLY IN LOCAL OFFLINE
      this.hasDataChanged = true;
      this.hasDeletedChanged = true;
      if (this.idAttributeName) {
        this.data = this.deleteItemFromContext(
          item?.[this.idAttributeName] as string
        );
        this.dataDeletedOffline = [
          ...this.dataDeletedOffline,
          item?.[this.idAttributeName] as string,
        ];

        if (this.hasDeletedChanged) {
          this.updateLocalDataDeletedOffline();
        }

        this.updateLocalData();
      }

      this.loading = false;
    }
  }
}
