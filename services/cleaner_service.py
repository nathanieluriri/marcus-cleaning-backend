
from bson import ObjectId
from fastapi import HTTPException
from typing import List

from repositories.cleaner_repo import (
    create_user,
    get_user,
    get_users,
    update_user,
    delete_user,
)
from schemas.cleaner_schema import CleanerCreate, CleanerUpdate, CleanerOut,CleanerBase,CleanerRefresh
from security.hash import check_password
from repositories.tokens_repo import get_refresh_tokens,delete_access_token,delete_refresh_token,delete_all_tokens_with_user_id
from services.auth_helpers import issue_tokens_for_user
from authlib.integrations.starlette_client import OAuth
import os
from dotenv import load_dotenv


load_dotenv()

 
oauth = OAuth()
oauth.register(
    name='google',
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)
async def add_user(user_data: CleanerCreate) -> CleanerOut:
    """adds an entry of CleanerCreate to the database and returns an object

    Returns:
        _type_: CleanerOut
    """
    cleaner =  await get_user(filter_dict={"email":user_data.email})
    if cleaner==None:
        new_user= await create_user(user_data)
        access_token, refresh_token = await issue_tokens_for_user(user_id=new_user.id, role="cleaner") # type: ignore
        new_user.password=""
        new_user.access_token= access_token
        new_user.refresh_token = refresh_token
        return new_user
    else:
        raise HTTPException(status_code=409,detail="Cleaner Already exists")

async def authenticate_user(user_data:CleanerBase )->CleanerOut:
    cleaner = await get_user(filter_dict={"email":user_data.email})

    if cleaner != None:
        if check_password(password=user_data.password,hashed=cleaner.password ): # type: ignore
            cleaner.password=""
            access_token, refresh_token = await issue_tokens_for_user(user_id=cleaner.id, role="cleaner") # type: ignore
            cleaner.access_token= access_token
            cleaner.refresh_token = refresh_token
            return cleaner
        else:
            raise HTTPException(status_code=401, detail="Unathorized, Invalid Login credentials")
    else:
        raise HTTPException(status_code=404,detail="Cleaner not found")

async def refresh_user_tokens_reduce_number_of_logins(user_refresh_data:CleanerRefresh,expired_access_token):
    refreshObj= await get_refresh_tokens(user_refresh_data.refresh_token)
    if refreshObj:
        if refreshObj.previousAccessToken==expired_access_token:
            cleaner = await get_user(filter_dict={"_id":ObjectId(refreshObj.userId)})
            
            if cleaner!= None:
                    access_token, refresh_token = await issue_tokens_for_user(user_id=cleaner.id, role="cleaner") # type: ignore
                    cleaner.access_token= access_token
                    cleaner.refresh_token = refresh_token
                    await delete_access_token(accessToken=expired_access_token)
                    await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
                    return cleaner
     
        await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
        await delete_access_token(accessToken=expired_access_token)
  
    raise HTTPException(status_code=404,detail="Invalid refresh token ")  
        
async def remove_user(user_id: str):
    """deletes a field from the database and removes UserCreateobject 

    Raises:
        HTTPException 400: Invalid cleaner ID format
        HTTPException 404:  Cleaner not found
    """
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    filter_dict = {"_id": ObjectId(user_id)}
    result = await delete_user(filter_dict)
    await delete_all_tokens_with_user_id(userId=user_id)

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cleaner not found")


async def retrieve_user_by_user_id(id: str) -> CleanerOut:
    """Retrieves cleaner object based specific Id 

    Raises:
        HTTPException 404(not found): if  Cleaner not found in the db
        HTTPException 400(bad request): if  Invalid cleaner ID format

    Returns:
        _type_: CleanerOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await get_user(filter_dict)

    if not result:
        raise HTTPException(status_code=404, detail="Cleaner not found")

    return result


async def retrieve_users(start=0,stop=100) -> List[CleanerOut]:
    """Retrieves CleanerOut Objects in a list

    Returns:
        _type_: CleanerOut
    """
    return await get_users(start=start,stop=stop)

async def update_user_by_id(user_id: str, user_data: CleanerUpdate, is_password_getting_changed: bool = False) -> CleanerOut:
    """updates an entry of cleaner in the database

    Raises:
        HTTPException 404(not found): if Cleaner not found or update failed
        HTTPException 400(not found): Invalid cleaner ID format

    Returns:
        _type_: CleanerOut
    """
    from core.queue.manager import QueueManager
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    filter_dict = {"_id": ObjectId(user_id)}
    result = await update_user(filter_dict, user_data)
    
    if not result:
        raise HTTPException(status_code=404, detail="Cleaner not found or update failed")
    if is_password_getting_changed is True:
        QueueManager.get_instance().enqueue("delete_tokens", {"userId": user_id})
    return result

async def authenticate_user_google(user_data: CleanerBase) -> CleanerOut:
    cleaner = await get_user(filter_dict={"email": user_data.email})

    if cleaner is None:
        new_user = await create_user(CleanerCreate(**user_data.model_dump()))
        cleaner = new_user

    access_token, refresh_token = await issue_tokens_for_user(user_id=cleaner.id, role="cleaner") # type: ignore
    cleaner.password = ""
    cleaner.access_token = access_token
    cleaner.refresh_token = refresh_token
    return cleaner

